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
2. 依次应用 `supabase/migrations/20260924000000_vocabulary_cards.sql`、`supabase/migrations/20261020000000_conjugation_progress.sql`、`supabase/migrations/20261022162053_verb_meaning_progress.sql` 与 `supabase/migrations/20261022163941_vocabulary_mistake_reviews.sql`。已有项目只需补充尚未应用的迁移。四份迁移分别配置词库、变位进度、含义进度与错题复习；数据按用户和授权邮箱隔离。应用迁移时应使用该项目已获授权的数据库管理方式。
3. 配置邮件 SMTP，并将生产站点的 URL 添加为 Auth Site URL 和允许的重定向地址；两个页面的回调地址 `/vocabulary/` 和 `/vocabulary/conjugation/` 均需加入允许列表。本地开发时对应添加 `http://localhost:4321/vocabulary/` 和 `http://localhost:4321/vocabulary/conjugation/`。
4. 本地将 `.env.example` 复制为 `.env`，填写 Supabase Project URL 和 publishable/anon key。若使用 GitHub Actions 发布，在仓库 Settings > Secrets and variables > Actions 中添加 `PUBLIC_SUPABASE_URL` 和 `PUBLIC_SUPABASE_ANON_KEY` 两个 Repository secrets；工作流会把它们传给构建步骤。只使用浏览器公开 key；不要把 `service_role`/secret key 放入网站或仓库。

单词记忆页按稳定顺序分批加载词库和错题，直到读取完所有记录，避免接口默认行数上限截断大词库。任意一批加载失败都会显示加载失败，不会用不完整的数据开始练习。`tests/load-all-rows.test.mjs` 覆盖 2,970 个词条、较低的服务端上限、整页边界和中途失败。

## 法语动词变位

全站“背单词”菜单点击后并列显示“单词记忆”（`/vocabulary/`）和“动词变位”（`/vocabulary/conjugation/`），桌面和手机均可使用；两个学习页顶部也提供同级切换。动词变位沿用词库登录会话。内置 142 个动词（原 100 个常用动词加 B2 论述专题），覆盖直陈式现在时、复合过去时、未完成过去时、简单将来时、现在条件式、现在虚拟式。默认混合练习，也可选择单一时态；每轮默认 10 题，可选择 10、20、30、50 或自定义正整数；按不重复的动词／时态／人称组合计数，同一动词可出现不同组合。

答案只填变位形式，不含主语或 `que`，复合过去时包含助动词。代词式须包含自反代词，如 `me prononce`，完整表达须包含补语，如 `suis persuadé`。判定忽略大小写、所有空白和重音差异，反馈保留标准拼写。六个人称为 `je / tu / il / nous / vous / ils`；être 复合时态明确使用阳性（后三者用复数），移动动词取不及物用法，例如 `nous sommes sortis`。`payer` 和 `essayer` 同时接受 i/y 两种规范拼写。

B2 专题来自两份公开教学资源的 43 词条并集（其中 penser 已有），新增 42 个；覆盖范围、逐词来源和代词式规则见 [B2 词库说明](docs/reference/b2-verbs.md)。

本地数据位于 `src/data/french-verbs.ts`，由人工整理的主要词形与屈折规则组成，不依赖运行时外部 API。未完成过去时通常取现在时 nous 词干，être 例外；虚拟式含双词干及不规则形式；-ger/-cer 保留拼写规则。词形交叉核对参考：[Verbiste 变位库说明](https://github.com/gauthier-th/conjugation-fr)。修改词表后运行 `npm test` 和 `npm run build`（测试需要 Node.js 22.6 或更新版本）。

`conjugation_progress` 按账号、动词和时态保存答题总数、正确数和最近练习时间；页面显示累计、正确率和各时态表现。新作答通过 `record_practice_answer` 将统计和错题一起原子保存；原 `record_conjugation_answer` 保留兼容旧版待同步请求。`conjugation_sync_receipts` 只保存账号和随机请求 ID 防止重试重复计数，不保存作答内容或逐题历史。两张表均启用 RLS；进度仅授权账号可读，写入只经检查身份的函数，回执不允许浏览器直接读写。

保存失败时会阻止进入下一题并提供重试；当前标签页的待同步请求暂存在按账号隔离的 `sessionStorage` 中，刷新后可继续同步。若浏览器禁用存储，当前页面仍可重试，但刷新或关闭会丢失未确认的请求。刷新不会保留未完成的题目轮次，已同步的汇总会保留。数据库尚未迁移或网络不可用时显示加载失败，可重试，不显示为零进度。

## 动词含义练习

在“动词变位”页选择独立的“动词含义”模式，每轮数量可选，默认随机抽取 10 个不同动词。题目展示法语原形，填写中文释义后点击“查看答案”，再选择“答对了 / 标错并重练”；答出任一常用义即可。未自评不计入完成进度，输入文字不参与自动判分。完成本轮后可切换模式，中途刷新会结束当前轮次。

142 个动词的简明中文常用义保存在 `src/data/french-verb-meanings.ts`，编排与来源见 [释义说明](docs/reference/verb-meanings.md)。英文界面下作答与标准答案仍为中文。

含义累计结果独立保存在 `verb_meaning_progress`，按账号和动词汇总；由 `record_practice_answer` 原子更新，与变位的时态统计分开；原 `record_verb_meaning_answer` 保留兼容旧版待同步请求。公开 RPC 使用调用者权限，受保护的写入函数位于非公开 `private` schema，检查登录身份和授权邮箱；回执仅存账号和随机请求 ID，阻止重复计数，不保存中文输入文本。含义与变位使用不同的待同步存储键。新客户端开始练习前会同时加载当前模式进度与错题，部署时需先补齐迁移。

## 每轮学习与错题复习

三种练习均支持 10／20／30／50 和自定义正整数，默认 10；浏览器按模式记住上次选择。候选不足时按实际数量练习并显示原因。单词记忆优先安排到期错题、其他到期复习和新词，每日最多引入 30 个新词；答错后将该题追加本轮队尾，重练仍错则再次追加，直到答对；重练不占新词额度，且不受 10 分钟到期时间限制。刷新结束未完成轮次，保留已保存的结果与数量偏好。

三种模式的错题分别保存在 `vocabulary_mistakes`。变位按动词、时态和人称区分，含义按动词区分，单词记忆按词条 ID 区分。含义依自评，单词记忆仅“标错并重练”（原“忘记”）算错。“只练错题”只选择当前模式和时态范围的到期记录，数量不足不补新题；错题本同时展示未到期、到期及已掌握记录。

复习间隔为 **10 分钟 → 1 天 → 3 天 → 7 天 → 14 天 → 30 天**。错题到期答对进入下一阶段，从本次保存时间起算；提前答对保留原到期时间，答错重置为 10 分钟，最终阶段答对标记掌握并保留记录，再错则重新激活。单词错题中的“困难／认识／简单”均按此规则推进，普通非错题沿用原评分间隔；错题期间卡片与错题使用同一个到期时间。站内显示到期提醒，不发送邮件通知。

`record_practice_answer` 的公开入口使用调用者权限，受检查的写入位于非公开 `private` schema。统计、错题状态、单词复习时间和去重回执在同一事务保存；`private.practice_sync_receipts` 仅保存账号、请求 ID 和题目标识。直接写错题表及未授权读写均被拒绝。旧词条和汇总保持原状，不从历史统计补造错题。三种模式均使用按账号隔离的待同步存储，保存失败可重试且不会重复计数。

本轮支持“上一词”，首题禁用，轮次完成后仍可返回。查看历史不产生作答；单词记忆选择新的评分、法语练习点击“重新评分”后提交，会通过 `replace_practice_answer` 替换对应原结果，不增加累计作答次数。尚未答过的重练队列随最终评分重新计算；后来已经提交的同词结果保留。重评用原提交时间重新计算复习安排，不通过反复修改评分延后到期时间。

为支持替换，`private.practice_answers` 保存题目标识、评分与复习状态快照，`private.practice_replacements` 保存幂等重评回执；均禁止客户端直接读写。不保存键入的答案。每次重评带预期版本，其他标签页已修改该项时拒绝覆盖。失败请求按账号保存在当前标签页，刷新后仍可恢复；轮次历史本身只存在内存中。旧进度和旧接口继续保留。

部署新前端前，先应用 `practice_answer_replacement` 和 `b2_verb_vocabulary` 两份迁移。重评事务验证见 `tests/sql/practice-replacement.sql`，B2 白名单验证见 `tests/sql/b2-verbs.sql`；均在最后回滚。

运行 `npm test`、`npm run build` 验证本地代码。`tests/sql/vocabulary-mistakes.sql` 是数据库集成验证脚本，需在已配置授权测试账号的数据库中由管理员执行；它测试阶段边界、原子计数、去重和权限，所有测试写入最终回滚。

## 复习计划

`/review-planner/` 使用现有私人账号，支持课表手动录入及 Excel／CSV 模板导入、单双周和调课、多场考试、AI 任务草稿、课外排程、计划预览及完成记录同步。AI 仅拆分考试范围，时间由本地规则安排；未配置 AI 时仍可手动创建任务。

上线前应用 `supabase/migrations/20261103142006_review_planner.sql`，部署 `review-task-breakdown` Edge Function，在 Supabase 服务端设置 `DEEPSEEK_API_KEY`。登录沿用已配置的 `/vocabulary/` 回调并自动返回复习计划，前端沿用现有公开环境变量。配置、排程规则及验证说明见 [复习计划说明](docs/review-planner.md)。

## 腾讯云发布（服务器无需 Git）

1. 在服务器创建仅 root 可读的证书目录（例如 `/etc/nginx/certs`），上传腾讯云下载的 `域名_bundle.crt` 和 `域名.key`；私钥文件权限设为 `600`。
2. 将 `deploy/nginx.conf.example` 中的域名、网站目录与证书文件路径替换为实际值，执行 `nginx -t` 验证后重载 Nginx。此项目使用你购买的腾讯云 TLS 证书，不使用 Certbot。
3. 在 GitHub 仓库 Secrets 中配置 `SITE_URL`、`SERVER_HOST`、`SERVER_USER`、`SERVER_SSH_KEY` 与 `SERVER_PATH`。
4. `SERVER_PATH` 指向 Nginx 的网站根目录，例如 `/home/ubuntu/personal-blog`；确保该用户可写入此目录。
5. 推送至 `main` 后，GitHub Actions 在云端安装依赖、构建 `dist/`，然后通过 SSH 上传成品。腾讯云只负责提供 Nginx 静态文件，不需要 Git 或 Node.js。

紧急手动发布：本地运行 `npm run build`，再通过 SCP/SFTP 将 `dist/` 内的文件上传到网站根目录。
