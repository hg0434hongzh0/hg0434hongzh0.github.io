# hongzh0 Blog Publisher

为 `hongzh0's Blog` 定制的 VS Code 写作与发布插件。

## 命令

- `Blog: 新建文章`：在 `content/posts/` 创建带 Front Matter 的 Markdown。
- `Blog: 使用 PicGo 上传图片`：选择本地图片，经 PicGo Server 上传到当前 Gitee 图床并插入 Markdown。
- `Blog: 生成静态页面`：生成文章 HTML，并更新首页、归档和 RSS。
- `Blog: 发布到 GitHub Pages`：生成页面、提交 Git 变更并推送。

## 写作目录

```text
content/posts/YYYY-MM-DD-slug.md
```

## PicGo

确保 PicGo Desktop 已启动“PicGo Server”，默认接口为：

```text
http://127.0.0.1:36677
```
