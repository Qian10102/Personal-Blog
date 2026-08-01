# 个人双语技术博客

Astro 静态博客；文章位于 `src/content/posts/`，站点资料位于 `src/config/site.ts`。每篇文章需提供标题、描述、日期、分类、标签、语言、置顶和草稿状态。

## 本地运行

```bash
npm install
npm run dev
```

使用 `npm run build` 生成 `dist/`。草稿（`draft: true`）不会被构建或收录到 RSS/搜索中。

## 腾讯云发布（服务器无需 Git）

1. 在服务器创建仅 root 可读的证书目录（例如 `/etc/nginx/certs`），上传腾讯云下载的 `域名_bundle.crt` 和 `域名.key`；私钥文件权限设为 `600`。
2. 将 `deploy/nginx.conf.example` 中的域名、网站目录与证书文件路径替换为实际值，执行 `nginx -t` 验证后重载 Nginx。此项目使用你购买的腾讯云 TLS 证书，不使用 Certbot。
3. 在 GitHub 仓库 Secrets 中配置 `SITE_URL`、`SERVER_HOST`、`SERVER_USER`、`SERVER_SSH_KEY` 与 `SERVER_PATH`。
4. `SERVER_PATH` 指向 Nginx 的网站根目录，例如 `/var/www/personal-blog`；确保该用户可写入此目录。
5. 推送至 `main` 后，GitHub Actions 在云端安装依赖、构建 `dist/`，然后通过 SSH 上传成品。腾讯云只负责提供 Nginx 静态文件，不需要 Git 或 Node.js。

紧急手动发布：本地运行 `npm run build`，再通过 SCP/SFTP 将 `dist/` 内的文件上传到网站根目录。
