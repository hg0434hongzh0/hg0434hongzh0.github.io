# hongzh0 Blog Publisher

为 `hongzh0's Blog` 定制的 VS Code 写作与发布插件。

## 命令

- `Blog: 新建文章`：在 `content/posts/` 创建带 Front Matter 的 Markdown，默认 `published: false`。
- `Blog: 使用 PicGo 上传图片`：选择本地图片，经 PicGo Server 上传到当前 Gitee 图床并插入 Markdown。
- `Blog: 生成静态页面`：测试并生成隔离的 `dist/`，包括文章、首页、归档、RSS、Sitemap 和 robots.txt。
- `Blog: 发布到 GitHub Pages`：构建后展示白名单内的 Git 变更，经两次确认再提交并推送。

## 写作目录

```text
content/posts/YYYY-MM-DD-slug.md
```

完成文章后把 `published` 改为 `true`。构建不会修改源模板，也不会把 `content/` 或插件源码复制到 `dist/`。

## 命令行构建

在博客仓库根目录执行：

```powershell
npm --prefix tools/hongzh0-blog-publisher test
npm --prefix tools/hongzh0-blog-publisher run build:site
```

GitHub Pages 应在仓库设置中选择 **GitHub Actions**，由 `.github/workflows/pages.yml` 测试、构建并部署 `dist/`。

## PicGo

确保 PicGo Desktop 已启动“PicGo Server”，默认接口为：

```text
http://127.0.0.1:36677
```
