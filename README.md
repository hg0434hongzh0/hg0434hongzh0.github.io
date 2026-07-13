# hongzh0's Blog · GitHub Pages

一个以 Markdown 写作、静态构建并部署到 GitHub Pages 的个人安全研究博客。界面强调中文排版、清晰层级、克制动效与可靠的移动端体验。

## 已包含

- 响应式首页、文章归档、关于页、文章详情页和 404 页面
- 深色 / 浅色主题，自动记忆用户选择
- 同源页面转场、滚动揭示、阅读进度与移动端导航
- 文章分类筛选
- RSS、Sitemap、robots.txt 与文章结构化数据
- 无前端框架，构建结果为纯静态文件
- 键盘导航、焦点管理与 `prefers-reduced-motion`

## 本地预览

首次使用先安装发布器依赖，再构建并预览 `dist/`：

```powershell
npm --prefix tools/hongzh0-blog-publisher ci
npm --prefix tools/hongzh0-blog-publisher run build:site
npx --yes http-server dist -p 8000
```

然后访问 `http://localhost:8000`。

`dist/` 是可删除、可重建的部署产物，不提交到 Git。

## 部署到 GitHub Pages

1. 打开仓库 **Settings -> Pages**。
2. 在 **Build and deployment** 中把 Source 设为 **GitHub Actions**。
3. 推送到 `main` 后，`.github/workflows/pages.yml` 会先运行测试，再构建并仅部署 `dist/`。
4. 部署产物只包含公开页面和资源；`content/`、`tools/` 不会进入 Pages。

自定义域名由根目录的 `CNAME` 管理，当前站点地址为 `https://hongzh0.wiki/`。

## 添加文章

博客的 Markdown 源文件统一放在：

```text
content/posts/
```

不要直接编辑 `dist/` 或根页面中的 `BLOG_*` 文章区块；这些内容由发布器生成。根目录 HTML 的其余部分与 `assets/` 是站点模板和公共资源。

## 使用 VS Code 写博客

已为本项目制作并安装 `hongzh0 Blog Publisher` 插件。在 VS Code 中按 `Ctrl+Shift+P`，可以使用：

- `Blog: 新建文章`
- `Blog: 使用 PicGo 上传图片`
- `Blog: 生成静态页面`
- `Blog: 发布到 GitHub Pages`

新文章默认写入 `published: false`，完成后改为 `true` 才会进入站点。发布命令会先运行测试和隔离构建，展示白名单内的待提交文件并要求确认，然后才执行 Git 提交与推送；它不会再使用 `git add -A`。

### 文章格式

```markdown
---
title: 文章标题
date: 2026-07-13
category: 漏洞分析
summary: 用于首页和搜索引擎的文章摘要
slug: article-url
coverText: 漏
published: false
---

这里开始写正文。
```

### PicGo 图床

插件使用本机 PicGo Server：

```text
http://127.0.0.1:36677
```

PicGo Desktop 必须保持运行，并启用 Gitee 上传器。打开 Markdown 后执行 `Blog: 使用 PicGo 上传图片`，插件会上传图片并自动插入 Markdown 链接。

插件源码和安装包构建目录位于：

```text
tools/hongzh0-blog-publisher/
```
