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
2. 在 SQL Editor 中依次执行 `supabase/migrations/20260924000000_vocabulary_cards.sql` 和 `supabase/migrations/20261020000000_conjugation_progress.sql`。已配置词库的项目只需执行第二份迁移。迁移启用用户和邮箱双重隔离策略，并创建变位进度表与原子计数函数。
3. 配置邮件 SMTP，并将生产站点的 URL 添加为 Auth Site URL 和允许的重定向地址；两个页面的回调地址 `/vocabulary/` 和 `/vocabulary/conjugation/` 均需加入允许列表。本地开发时对应添加 `http://localhost:4321/vocabulary/` 和 `http://localhost:4321/vocabulary/conjugation/`。
4. 本地将 `.env.example` 复制为 `.env`，填写 Supabase Project URL 和 publishable/anon key。若使用 GitHub Actions 发布，在仓库 Settings > Secrets and variables > Actions 中添加 `PUBLIC_SUPABASE_URL` 和 `PUBLIC_SUPABASE_ANON_KEY` 两个 Repository secrets；工作流会把它们传给构建步骤。只使用浏览器公开 key；不要把 `service_role`/secret key 放入网站或仓库。

## 法语动词变位

全站“背单词”菜单点击后并列显示“单词记忆”（`/vocabulary/`）和“动词变位”（`/vocabulary/conjugation/`），桌面和手机均可使用；两个学习页顶部也提供同级切换。动词变位沿用词库登录会话。内置 100 个常用动词，覆盖直陈式现在时、复合过去时、未完成过去时、简单将来时、现在条件式、现在虚拟式。默认混合练习，也可选择单一时态；每轮抽取 10 道不重复的动词／时态／人称组合。

答案只填变位形式，不含主语或 `que`，复合过去时包含助动词。判定忽略大小写、所有空白和重音差异，反馈保留标准拼写。六个人称为 `je / tu / il / nous / vous / ils`；être 复合时态明确使用阳性（后三者用复数），移动动词取不及物用法，例如 `nous sommes sortis`。`payer` 和 `essayer` 同时接受 i/y 两种规范拼写。

本地数据位于 `src/data/french-verbs.ts`，由人工整理的主要词形与屈折规则组成，不依赖运行时外部 API。未完成过去时通常取现在时 nous 词干，être 例外；虚拟式含双词干及不规则形式；-ger/-cer 保留拼写规则。词形交叉核对参考：[Verbiste 变位库说明](https://github.com/gauthier-th/conjugation-fr)。修改词表后运行 `npm test` 和 `npm run build`（测试需要 Node.js 22.6 或更新版本）。

`conjugation_progress` 按账号、动词和时态保存答题总数、正确数和最近练习时间；页面显示累计、正确率和各时态表现。每题通过 `record_conjugation_answer` 同步，数据库原子递增；`conjugation_sync_receipts` 只保存账号和随机请求 ID 防止重试重复计数，不保存作答内容或逐题历史。两张表均启用 RLS；进度仅授权账号可读，写入只经检查身份的函数，回执不允许浏览器直接读写。

保存失败时会阻止进入下一题并提供重试；当前标签页的待同步请求暂存在按账号隔离的 `sessionStorage` 中，刷新后可继续同步。若浏览器禁用存储，当前页面仍可重试，但刷新或关闭会丢失未确认的请求。刷新不会保留未完成的题目轮次，已同步的汇总会保留。数据库尚未迁移或网络不可用时显示加载失败，可重试，不显示为零进度。

## 腾讯云发布（服务器无需 Git）

1. 在服务器创建仅 root 可读的证书目录（例如 `/etc/nginx/certs`），上传腾讯云下载的 `域名_bundle.crt` 和 `域名.key`；私钥文件权限设为 `600`。
2. 将 `deploy/nginx.conf.example` 中的域名、网站目录与证书文件路径替换为实际值，执行 `nginx -t` 验证后重载 Nginx。此项目使用你购买的腾讯云 TLS 证书，不使用 Certbot。
3. 在 GitHub 仓库 Secrets 中配置 `SITE_URL`、`SERVER_HOST`、`SERVER_USER`、`SERVER_SSH_KEY` 与 `SERVER_PATH`。
4. `SERVER_PATH` 指向 Nginx 的网站根目录，例如 `/home/ubuntu/personal-blog`；确保该用户可写入此目录。
5. 推送至 `main` 后，GitHub Actions 在云端安装依赖、构建 `dist/`，然后通过 SSH 上传成品。腾讯云只负责提供 Nginx 静态文件，不需要 Git 或 Node.js。

紧急手动发布：本地运行 `npm run build`，再通过 SCP/SFTP 将 `dist/` 内的文件上传到网站根目录。
