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

## 文章加密

需要加密正文时，在文章 Front Matter 中加入：

```yaml
encrypted: true
```

密码不得写入 Markdown 或提交到 Git。构建时通过环境变量提供一个 `slug -> 密码` 的 JSON 对象，密码至少 8 个字符：

```powershell
$env:BLOG_POST_PASSWORDS_JSON='{"gogs-org-path-traversal-rce":"请替换为强密码"}'
npm --prefix tools/hongzh0-blog-publisher run build:site
```

GitHub Actions 部署时，在仓库的 **Settings → Secrets and variables → Actions** 中创建名为 `BLOG_POST_PASSWORDS_JSON` 的 Repository secret，值使用同样的 JSON 格式。也可以在单篇文章中设置 `passwordEnv: MY_POST_PASSWORD`，再由对应环境变量提供密码。

加密文章仍公开标题、发布日期、分类、摘要、阅读时长和章节数量；正文与目录使用 AES-256-GCM 加密，访问者输入密码后由浏览器 Web Crypto API 在本地解密。此方式不能阻止离线猜测弱密码，因此应使用足够长且不可复用的密码。

> **重要：** 当前 GitHub Pages 仓库是公开仓库。若把明文 Markdown 提交到 `content/posts/`，任何人仍可直接从 GitHub 查看源文件。需要真正保密时，必须把源稿放在私有仓库/私有构建流程中，只向 Pages 发布生成后的 `dist/`；本功能负责加密生成页面，不会抹除 Git 历史里的明文。

## 国内访问优化

站点字体已改为随站点发布，不再依赖 Google Fonts；文章正文图片会自动生成 `loading="lazy"` 和 `decoding="async"`，减少首屏阻塞。页面结构与既有视觉样式保持不变。

GitHub Pages 在中国大陆的网络质量仍取决于运营商线路。若需要进一步稳定访问，应在完成域名备案后接入支持中国大陆节点的 CDN；这需要域名、备案和 CDN 账号配置，不能仅靠仓库代码完成。
