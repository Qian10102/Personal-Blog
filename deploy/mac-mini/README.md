# Mac mini 部署

生产网站：https://zihan-server.com 和 https://www.zihan-server.com 。
本机入口：http://127.0.0.1:8081 ，仅本机可访问。

## 结构与当前内容

访问路径：访客 → Cloudflare HTTPS → HTTP2 加密隧道 → Docker 内的 Nginx 静态网站。

- `compose.yaml` 管理博客和正式隧道两个容器，固定镜像摘要、健康检查、日志大小和自动重启。
- `cloudflared.yml` 只接受根域名和 www，其他主机名返回 404。
- 首次上线使用从腾讯云复制并核对的 98 个文件、55 个 HTML 页面。迁移和本次发布流程调整均保留原网站内容；本机未发布的编辑需主动运行发布命令才会上线。
- `site/releases/` 保存每次发布，`site/current` 指向当前版本，`site/previous` 指向上一版本；`site/_astro/` 保留旧版使用的带内容哈希的资源。
- 站点成品和 `secrets/` 均被 Git 忽略；运行隧道的容器只挂载该隧道的 `tunnel.json`，不持有管理账户的 `cert.pem`。
- 当前宿主用户为 501:20，隧道以该非 root 用户运行，以读取权限为 600 的凭据文件。

登录、词库、学习进度和复习计划继续连接现有 Supabase。本次只迁移网站静态文件，后端数据仍在原 Supabase 项目。域名未变，现有登录回调继续使用原域名；本机 8081 预览地址未单独配置登录回调。

## 启动、检查与停止

在项目根目录运行：

```sh
docker compose -f deploy/mac-mini/compose.yaml up -d --wait
docker compose -f deploy/mac-mini/compose.yaml ps
docker compose -f deploy/mac-mini/compose.yaml logs --tail 30 cloudflared
```

两个服务都应显示 healthy。页面响应中的 `X-Origin-Server: mac-mini` 用于确认请求确实回到 Mac。

停止博客和隧道：

```sh
docker compose -f deploy/mac-mini/compose.yaml down
```

此配置仅管理 `personal-blog-mac-mini` 项目，本地入口使用 8081。

## 修改与发布

在终端进入项目目录：

```sh
cd '/Users/qian10102/Documents/02 Projects/Personal Blog'
```

使用 Node.js 22.6 或更新版本。首次安装或依赖发生变化后执行 `npm ci`。日常可运行 `npm run dev` 预览修改；完成后执行一次：

```sh
npm run deploy:local
```

发布读取 `.env` 中的 `PUBLIC_SUPABASE_URL`、`PUBLIC_SUPABASE_ANON_KEY`，默认站点地址为 `https://zihan-server.com`。它发布当前已保存的源码，包含尚未提交 Git 的修改。GitHub 自动发布已移除，Git 提交和推送仍可用于备份。

命令依次检查 Docker、运行全部测试、校验 Astro/TypeScript 并构建，在独立的临时目录生成成品。检查通过后才创建新版本、一次切换当前目录，并核对首页、学习页、全部构建资源与两个容器状态。Docker 文件同步存在短暂延迟时会自动重试，每秒重新核对，最多等待 60 秒；各网页和资源须在同一轮中全部与发布文件一致才算通过。持续返回旧内容、HTTP 错误或无法连接，超过时限后会恢复原版本；回退命令也使用相同的等待核对流程。此流程不会使用或清空普通 `dist/`，也不会更改 Supabase 数据库。

只做完整检查而不上线：

```sh
npm run deploy:check
```

恢复上一次成功发布的版本：

```sh
npm run deploy:rollback
```

回退命令不需要重新构建，因此源码有错误时仍可恢复。再次执行回退可切回刚才的版本。它只恢复网站文件；不撤销数据库或用户学习数据。第一次发布前没有上一版本时会拒绝回退。

### 缓存与文件保留

普通网页、图片要求浏览器重新验证；带哈希的 `/_astro/` 资源使用长期缓存并保留旧文件，已打开的旧网页仍能加载对应资源。切换本流程时已清除 Cloudflare 旧缓存，并将浏览器缓存 TTL 设为遵循现有标头。此前已被浏览器缓存的旧图片若仍未更新，可强制刷新一次。日常发布无需手动重启隧道或修改 DNS。

已发布版本和旧资源保留在本机且不进入 Git，目前不自动清理，以便恢复。请定期备份项目源码、`.env`、发布目录和隧道凭据；备份私密配置时不要提交到公开仓库。不要再向 `site/` 直接执行带 `--delete` 的同步命令，以免删除版本和链接。

### 异常中断

正常失败会自动解除发布锁。若终端被强制结束，重试提示已有发布任务，请先确认之前的发布进程已结束，再删除残留的 `deploy/mac-mini/site/.publish-lock.json` 后重试；不要在仍有发布任务时删除它。发布错误详情直接显示在终端，正式网站继续使用当前版本。

## DNS 与 HTTPS

域名注册和续费仍在腾讯云，权威 DNS 已切换至：

- `gannon.ns.cloudflare.com`
- `gwen.ns.cloudflare.com`

Cloudflare 的根域名和 www 均为启用代理的 CNAME，指向：

`5ba9b980-f734-49fa-a060-1dfd6bc541b4.cfargotunnel.com`

原来指向腾讯云的根域名/www A 和 AAAA 已替换。`auth` 子域名仍委托给 DNSPod 的 `f1g1ns1.dnspod.net` 和 `f1g1ns2.dnspod.net`，原 `_dnsauth` TXT 验证记录保留。

auth 子区域另保留 DKIM、DMARC 和两个邮件服务 CNAME。2026-11-14 已在 DNSPod 暂停其 @ A=101.43.64.168，权威 DNS 和公共解析器均不再返回旧 IP；保留 NS 委托供邮件验证使用。

公网 HTTPS 由 Cloudflare 提供，并已开启“始终使用 HTTPS”。Cloudflare 到 Mac 使用加密隧道，隧道与网站容器之间在本机 Docker 网络中使用 HTTP。原腾讯云私钥没有复制到本机。

切换时部分递归 DNS 缓存会继续指向腾讯云，原站继续运行以承接这些访问。原记录 TTL 为 600 秒，个别解析链路也可能保留旧名称服务器缓存更久。

## 运行条件与恢复边界

Mac 和 Docker 需要保持运行、联网。Docker 已设置登录后自动启动，两个容器配置 `unless-stopped`。Mac 已关闭自动睡眠；整机断电后自动开机、系统登录或磁盘解锁等无人值守恢复尚未验收。

本次网络验收使用当前代理/VPN环境；关闭代理后的独立直连可用性尚未验证。UDP/QUIC 在当前网络下不可用，因此固定使用已验证的 TCP/HTTP2。

如果需要恢复网站到腾讯云，可在 Cloudflare 删除两个网站 CNAME 并恢复原 A/AAAA；auth 委托和 TXT 保留。原 IPv4 为 `101.43.64.168`，IPv6 为 `2402:4e00:c032:2600:9c56:bfb6:7a1c:0`。原记录备份已保存在本次聊天输出中。

腾讯云仍有 TrendRadar 历史和其他旧服务；本次域名切换没有退役云服务器。

参考：

- [Cloudflare Tunnel 配置](https://developers.cloudflare.com/tunnel/get-started/)
- [Cloudflare DNS 托管切换](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
- [Docker 容器自动重启](https://docs.docker.com/engine/containers/start-containers-automatically/)
