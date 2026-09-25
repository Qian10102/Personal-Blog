# 个人双语技术博客

Astro 静态博客；文章位于 `src/content/posts/`，站点资料位于 `src/config/site.ts`。每篇文章需提供标题、描述、日期、分类、标签、语言、置顶和草稿状态。

## 本地运行

```bash
npm install
npm run dev
```

使用 `npm run build` 生成 `dist/`。草稿（`draft: true`）不会被构建或收录到 RSS/搜索中。

## 背单词功能配置

背词页面使用 Supabase Auth 和 Postgres。页面只允许 `qianzihanduo@gmail.com` 登录，词条表通过 RLS 将数据限制到该邮箱对应的账号。服务未配置时，页面会显示配置提示。

1. 创建 Supabase 项目，在 Authentication 的用户注册设置中关闭公开注册，并邀请 `qianzihanduo@gmail.com`。
2. 在 SQL Editor 中执行 `supabase/migrations/20260924000000_vocabulary_cards.sql`。迁移会创建个人词条表并启用用户和邮箱双重隔离策略。
3. 配置邮件 SMTP，并将生产站点的 URL 添加为 Auth Site URL 和允许的重定向地址；本地开发时也添加 `http://localhost:4321/vocabulary/`。
4. 本地将 `.env.example` 复制为 `.env`，填写 Supabase Project URL 和 publishable/anon key。若使用 GitHub Actions 发布，在仓库 Settings > Secrets and variables > Actions 中添加 `PUBLIC_SUPABASE_URL` 和 `PUBLIC_SUPABASE_ANON_KEY` 两个 Repository secrets；工作流会把它们传给构建步骤。只使用浏览器公开 key；不要把 `service_role`/secret key 放入网站或仓库。

## 腾讯云发布（服务器无需 Git）

1. 在服务器创建仅 root 可读的证书目录（例如 `/etc/nginx/certs`），上传腾讯云下载的 `域名_bundle.crt` 和 `域名.key`；私钥文件权限设为 `600`。
2. 将 `deploy/nginx.conf.example` 中的域名、网站目录与证书文件路径替换为实际值，执行 `nginx -t` 验证后重载 Nginx。此项目使用你购买的腾讯云 TLS 证书，不使用 Certbot。
3. 在 GitHub 仓库 Secrets 中配置 `SITE_URL`、`SERVER_HOST`、`SERVER_USER`、`SERVER_SSH_KEY` 与 `SERVER_PATH`。
4. `SERVER_PATH` 指向 Nginx 的网站根目录，例如 `/home/ubuntu/personal-blog`；确保该用户可写入此目录。
5. 推送至 `main` 后，GitHub Actions 在云端安装依赖、构建 `dist/`，然后通过 SSH 上传成品。腾讯云只负责提供 Nginx 静态文件，不需要 Git 或 Node.js。

紧急手动发布：本地运行 `npm run build`，再通过 SCP/SFTP 将 `dist/` 内的文件上传到网站根目录。
