const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { buildSite, slugify } = require('./lib/publisher');

const execFileAsync = promisify(execFile);
let output;

function config() { return vscode.workspace.getConfiguration('hongzh0Blog'); }
function getRoot() {
  const folders = vscode.workspace.workspaceFolders || [];
  for (const folder of folders) {
    const root = folder.uri.fsPath;
    if (fs.existsSync(path.join(root, 'index.html')) && fs.existsSync(path.join(root, 'archive.html'))) return root;
  }
  throw new Error('请先在 VS Code 中打开博客根目录（需要包含 index.html 和 archive.html）。');
}
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
function yamlString(value) { return JSON.stringify(String(value)); }
function requestJson(urlText, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlText);
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request({ hostname: url.hostname, port: url.port, path: url.pathname || '/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }, timeout: 120000 }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`PicGo 返回 HTTP ${res.statusCode}: ${data}`));
          resolve(parsed);
        } catch (error) { reject(new Error(`无法解析 PicGo 响应：${data || error.message}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('PicGo 上传超时。')));
    req.on('error', reject);
    req.write(body); req.end();
  });
}
function extractPicGoUrls(response) {
  const result = response && response.result;
  if (!response || response.success !== true || !Array.isArray(result)) throw new Error(response?.message || 'PicGo 上传失败，请检查 PicGo 日志和 Gitee 配置。');
  return result.map(item => typeof item === 'string' ? item : item?.imgUrl || item?.url).filter(Boolean);
}
async function runGit(root, args, options = {}) {
  output.appendLine(`> git ${args.join(' ')}`);
  const result = await execFileAsync('git', args, { cwd: root, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  if (result.stdout && options.logOutput !== false) output.appendLine(result.stdout.trim());
  if (result.stderr) output.appendLine(result.stderr.trim());
  return result.stdout;
}

async function runPublisherTests(root) {
  const publisherDirectory = path.join(root, 'tools', 'hongzh0-blog-publisher');
  if (!fs.existsSync(path.join(publisherDirectory, 'package.json'))) {
    throw new Error('找不到发布器测试目录：tools/hongzh0-blog-publisher');
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  output.appendLine('> npm test');
  const result = await execFileAsync(npm, ['test'], {
    cwd: publisherDirectory,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.stdout) output.appendLine(result.stdout.trim());
  if (result.stderr) output.appendLine(result.stderr.trim());
}

function gitPath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function publishAllowlist(root) {
  const configuredPosts = path.resolve(root, config().get('postsDirectory', 'content/posts'));
  const relativePosts = gitPath(path.relative(root, configuredPosts));
  if (!relativePosts || relativePosts === '..' || relativePosts.startsWith('../')) {
    throw new Error('文章目录必须位于博客仓库内。');
  }
  return {
    directories: [
      relativePosts,
      'assets',
      'tools/hongzh0-blog-publisher/bin',
      'tools/hongzh0-blog-publisher/lib',
      'tools/hongzh0-blog-publisher/test'
    ],
    files: [
      'index.html',
      'archive.html',
      'about.html',
      '404.html',
      'CNAME',
      '.nojekyll',
      '.gitattributes',
      '.gitignore',
      'README.md',
      '.github/workflows/pages.yml',
      'tools/hongzh0-blog-publisher/extension.js',
      'tools/hongzh0-blog-publisher/README.md',
      'tools/hongzh0-blog-publisher/package.json',
      'tools/hongzh0-blog-publisher/package-lock.json'
    ]
  };
}

function isPublishablePath(file, allowlist) {
  const normalized = gitPath(file);
  return allowlist.files.includes(normalized)
    || allowlist.directories.some(directory => normalized === directory || normalized.startsWith(`${directory}/`));
}

function parseStatusPaths(status, allowlist) {
  const records = status.split('\0');
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const state = record.slice(0, 2);
    const currentPath = record.slice(3);
    if (isPublishablePath(currentPath, allowlist)) paths.push(gitPath(currentPath));
    if (/[RC]/.test(state) && records[index + 1]) {
      index += 1;
      if (isPublishablePath(records[index], allowlist)) paths.push(gitPath(records[index]));
    }
  }
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

async function publishableChanges(root) {
  const allowlist = publishAllowlist(root);
  const pathspecs = [...allowlist.directories, ...allowlist.files];
  const status = await runGit(
    root,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...pathspecs],
    { logOutput: false }
  );
  return parseStatusPaths(status, allowlist);
}

async function newPost() {
  const root = getRoot();
  const title = await vscode.window.showInputBox({ title: '新建博客文章', prompt: '文章标题', validateInput: v => v.trim() ? undefined : '标题不能为空' });
  if (!title) return;
  const category = await vscode.window.showQuickPick(['漏洞分析', '代码审计', '攻防实践', '工具开发', '研究笔记'], { title: '选择文章分类' });
  if (!category) return;
  const summary = await vscode.window.showInputBox({ title: '文章摘要', prompt: '用于首页、归档和搜索引擎描述', validateInput: v => v.trim() ? undefined : '摘要不能为空' });
  if (!summary) return;
  const fallback = `post-${today().replaceAll('-', '')}`;
  const slug = await vscode.window.showInputBox({ title: '文章 URL', prompt: '仅使用小写字母、数字和连字符', value: fallback, validateInput: v => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) ? undefined : '请使用小写字母、数字和连字符' });
  if (!slug) return;
  const coverText = await vscode.window.showInputBox({ title: '封面文字', prompt: '封面中央显示 1～2 个字', value: category.slice(0, 1), validateInput: v => v.trim() && [...v.trim()].length <= 2 ? undefined : '请输入 1～2 个字符' });
  if (!coverText) return;
  const dir = path.join(root, config().get('postsDirectory', 'content/posts'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${today()}-${slugify(slug)}.md`);
  if (fs.existsSync(file)) throw new Error(`文章已存在：${path.basename(file)}`);
  const content = `---\ntitle: ${yamlString(title)}\ndate: ${today()}\ncategory: ${yamlString(category)}\nsummary: ${yamlString(summary)}\nslug: ${slug}\ncoverText: ${yamlString(coverText.trim())}\npublished: false\n---\n\n在这里开始写作。\n\n## 背景\n\n## 分析\n\n## 验证\n\n## 修复建议\n`;
  fs.writeFileSync(file, content, 'utf8');
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  vscode.window.showInformationMessage(`文章已创建：content/posts/${path.basename(file)}`);
}

async function uploadImage() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') throw new Error('请先打开 Markdown 文章，并把光标放到需要插图的位置。');
  const files = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: '上传到 Gitee 图床', filters: { '图片': ['png','jpg','jpeg','gif','webp','svg'] } });
  if (!files?.length) return;
  const alt = files.length === 1 ? await vscode.window.showInputBox({ title: '图片说明', value: path.basename(files[0].fsPath, path.extname(files[0].fsPath)) }) : '';
  const endpoint = config().get('picgoServer', 'http://127.0.0.1:36677').replace(/\/$/, '') + '/upload';
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在通过 PicGo 上传 ${files.length} 张图片…`, cancellable: false }, async () => {
    const response = await requestJson(endpoint, { list: files.map(file => file.fsPath) });
    const urls = extractPicGoUrls(response);
    if (!urls.length) throw new Error('PicGo 返回成功，但没有图片 URL。');
    const markdown = urls.map((url, i) => `![${files.length === 1 ? (alt || '') : path.basename(files[i]?.fsPath || `image-${i+1}`)}](${url})`).join('\n\n');
    await editor.edit(edit => edit.insert(editor.selection.active, markdown));
    vscode.window.showInformationMessage(`已上传 ${urls.length} 张图片并插入 Markdown。`);
  });
}

async function build() {
  const root = getRoot();
  await vscode.workspace.saveAll();
  const result = buildSite(root, { postsDirectory: config().get('postsDirectory', 'content/posts'), baseUrl: 'https://hongzh0.wiki/' });
  output.appendLine(`生成完成：${result.posts.length} 篇文章 -> ${result.outputDirectory}`);
  result.generated.forEach(file => output.appendLine(`  - dist/${file}`));
  vscode.window.showInformationMessage(`博客已生成到 dist：${result.posts.length} 篇文章。`);
  return result;
}

async function publish() {
  const root = getRoot();
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在生成并发布博客…', cancellable: false }, async progress => {
    await vscode.workspace.saveAll();
    progress.report({ message: '运行发布器测试' });
    await runPublisherTests(root);
    progress.report({ message: '构建隔离部署产物' });
    const result = await build();
    progress.report({ message: '检查可发布的源文件' });
    const files = await publishableChanges(root);
    if (!files.length) {
      vscode.window.showInformationMessage('构建与测试已通过，没有需要提交的博客源文件。');
      return;
    }

    output.appendLine('本次允许提交的文件：');
    files.forEach(file => output.appendLine(`  - ${file}`));
    output.show(true);
    const reviewed = await vscode.window.showWarningMessage(
      `请检查本次发布的 ${files.length} 个文件。`,
      { modal: true, detail: files.join('\n') },
      '文件无误'
    );
    if (reviewed !== '文件无误') return;

    const message = await vscode.window.showInputBox({ title: '发布博客', prompt: 'Git 提交说明', value: `Publish blog: ${result.posts[0].title}` });
    if (!message) return;

    const action = config().get('autoPush', true) ? '提交并推送到 GitHub' : '仅提交到本地 Git';
    const confirmed = await vscode.window.showWarningMessage(
      action,
      { modal: true, detail: `提交说明：${message}\n文件数量：${files.length}` },
      '确认发布'
    );
    if (confirmed !== '确认发布') return;

    progress.report({ message: '提交文章' });
    await runGit(root, ['add', '--', ...files]);
    await runGit(root, ['commit', '--only', '-m', message, '--', ...files]);
    if (config().get('autoPush', true)) {
      progress.report({ message: '推送到 GitHub Pages' });
      await runGit(root, ['push']);
      vscode.window.showInformationMessage('博客发布成功，GitHub Pages 正在更新。', '打开博客').then(choice => {
        if (choice === '打开博客') vscode.env.openExternal(vscode.Uri.parse('https://hongzh0.wiki/'));
      });
    } else {
      vscode.window.showInformationMessage('博客已生成并提交，自动推送已关闭。');
    }
  });
}

async function safeRun(fn) {
  try { await fn(); }
  catch (error) {
    output.appendLine(error.stack || String(error));
    vscode.window.showErrorMessage(`Blog Publisher：${error.message || error}`, '查看日志').then(choice => { if (choice === '查看日志') output.show(); });
  }
}

function activate(context) {
  output = vscode.window.createOutputChannel('hongzh0 Blog Publisher');
  context.subscriptions.push(output);
  context.subscriptions.push(vscode.commands.registerCommand('hongzh0Blog.newPost', () => safeRun(newPost)));
  context.subscriptions.push(vscode.commands.registerCommand('hongzh0Blog.uploadImage', () => safeRun(uploadImage)));
  context.subscriptions.push(vscode.commands.registerCommand('hongzh0Blog.build', () => safeRun(build)));
  context.subscriptions.push(vscode.commands.registerCommand('hongzh0Blog.publish', () => safeRun(publish)));
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 30);
  status.text = '$(rocket) 发布博客';
  status.tooltip = "生成 hongzh0's Blog 并推送到 GitHub Pages";
  status.command = 'hongzh0Blog.publish';
  status.show();
  context.subscriptions.push(status);
}
function deactivate() {}
module.exports = { activate, deactivate, extractPicGoUrls };
