# hongzh0's Blog · GitHub Pages

一个无需构建工具、上传即可部署的个人安全研究博客。界面强调中文排版、清晰层级、温和配色和克制动效。

## 已包含

- 响应式首页、文章归档、关于页、文章详情页和 404 页面
- 深色 / 浅色主题，自动记忆用户选择
- 移动端导航
- 文章分类筛选
- RSS 示例文件
- 无框架、无构建依赖，适合 GitHub Pages
- 基础无障碍支持与 `prefers-reduced-motion`

## 本地预览

在项目目录执行：

```powershell
python -m http.server 8000
```

然后访问 `http://localhost:8000`。

## 部署为 GitHub 用户主页

1. 在 GitHub 创建名为 `你的用户名.github.io` 的公开仓库。
2. 将本目录所有文件推送到仓库的 `main` 分支。
3. 打开仓库 **Settings → Pages**。
4. 在 **Build and deployment** 中选择 **Deploy from a branch**。
5. Branch 选择 `main` 和 `/(root)`，保存。
6. 稍等片刻后访问 `https://你的用户名.github.io/`。

```powershell
git init
git add .
git commit -m "Create personal blog"
git branch -M main
git remote add origin https://github.com/你的用户名/你的用户名.github.io.git
git push -u origin main
```

## 建议优先修改

- 全局搜索替换 `hello@example.com` 和 GitHub 地址
- 修改首页和归档中的示例文章
- 把 `about.html` 里的照片占位区域替换为你的照片
- 将 `feed.xml` 中的 `hg0434hongzh0` 替换成 GitHub 用户名
- 若使用自定义域名，在根目录增加 `CNAME` 文件，内容只写域名

## 添加文章

复制 `posts/security-research-workflow.html`，修改标题、日期、摘要和正文，再分别在 `index.html` 与 `archive.html` 添加入口即可。

