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
async function runGit(root, args) {
  output.appendLine(`> git ${args.join(' ')}`);
  const result = await execFileAsync('git', args, { cwd: root, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  if (result.stdout) output.appendLine(result.stdout.trim());
  if (result.stderr) output.appendLine(result.stderr.trim());
  return result.stdout;
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
  const content = `---\ntitle: ${yamlString(title)}\ndate: ${today()}\ncategory: ${yamlString(category)}\nsummary: ${yamlString(summary)}\nslug: ${slug}\ncoverText: ${yamlString(coverText.trim())}\npublished: true\n---\n\n在这里开始写作。\n\n## 背景\n\n## 分析\n\n## 验证\n\n## 修复建议\n`;
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
  output.appendLine(`生成完成：${result.posts.length} 篇文章`);
  result.generated.forEach(file => output.appendLine(`  - ${file}`));
  vscode.window.showInformationMessage(`博客已生成：${result.posts.length} 篇文章。`);
  return result;
}

async function publish() {
  const root = getRoot();
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在生成并发布博客…', cancellable: false }, async progress => {
    progress.report({ message: '生成静态页面' });
    const result = await build();
    progress.report({ message: '检查 Git 变更' });
    const status = await runGit(root, ['status', '--porcelain']);
    if (!status.trim()) {
      vscode.window.showInformationMessage('博客已经是最新状态，没有需要发布的变更。');
      return;
    }
    const message = await vscode.window.showInputBox({ title: '发布博客', prompt: 'Git 提交说明', value: `Publish blog: ${result.posts[0].title}` });
    if (!message) return;
    progress.report({ message: '提交文章' });
    await runGit(root, ['add', '-A']);
    await runGit(root, ['commit', '-m', message]);
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
