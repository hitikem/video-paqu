# Changelog

本仓库从 Mori v4.5.0（2026-10-15）分叉而来。此前的上游历史见
https://github.com/coflyn/Mori/blob/main/CHANGELOG.md 。

---

## [1.0.0] - 2026-10-18

首个「视频爬取 / VideoPaqu」版本，基线为 Mori v4.5.0。

### Added

- **自托管 Web 模式**：`server/index.js`
  - 静态托管 `public/`，`/api/scrape`、`/api/resolve`、`/api/http`、`/api/download`、`/api/health`、`/api/platforms`
  - 服务端流式下载，自动补 `Referer` / `User-Agent`，绕开第三方 CDN 的防盗链
  - SSRF 防护：拒绝内网、回环、链路本地与 CGNAT 地址；限制响应体大小（16 MiB）与超时（30 s）
  - 默认只监听 `127.0.0.1`
- 前端 Web 适配：浏览器中 `scraperFetch` 自动改走 `/api/http`；下载改走 `/api/download`

### Changed

- 品牌：界面、通知、安装包显示名改为「视频爬取」
- 默认下载目录：`Download/VideoPaqu`、`~/Downloads/VideoPaqu`、`Music/VideoPaqu`
- CLI 配置目录：`~/.videopaque`
- CLI 不再查询上游 `@coflyn/mori` 的 npm 版本

### Security

- **移除在线热更新**：不再下载远程 JS 并 `new Function` / `eval` 执行
  - `public/js/scrapers/index.js` 只加载随包的 `bundle.js`
  - `public/js/modules/updateScrapers.js` 默认 `OTA_ENABLED = false`
  - `cli/engine.js` 不再 `eval` `~/.mori/scrapers-bundle.js`
  - `cli/index.js` 移除启动时的静默后台更新

### Removed

- `landing/`（上游产品官网）、`GUIDE.md`、`CONTRIBUTING.md`
