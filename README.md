# 视频爬取 · VideoPaqu

自托管的多平台视频 / 音频 / 图集下载工具。三种形态共用同一套抓取引擎：

- **Web 模式（本仓库新增）**：`npm start` 起一个本地服务，浏览器直接用，不再受 CORS 与防盗链限制。
- **CLI**：`node cli/index.js <URL>`，适合脚本与批量任务。
- **桌面 / 移动端**：同一份 `public/` 可分别由 Tauri（Windows/macOS）与 Capacitor（Android/iOS）打包。

> **来源说明**：本项目是 [coflyn/Mori](https://github.com/coflyn/Mori) 的 **GPL-3.0 衍生作品**，不是从零开始的原创实现。
> 原始代码版权归 coflyn 所有，详见 [NOTICE](NOTICE) 与 [LICENSE](LICENSE)。本仓库的修改同样以 GPL-3.0-or-later 发布。

---

## 功能

- 16 个平台：TikTok、Instagram、YouTube、X/Twitter、Spotify、Apple Music、Pinterest、Facebook、Threads、Bandcamp、Pixiv、Bilibili、抖音、小红书、Reddit、TeraBox
- 无水印视频、原图图集、音频流（MP3/M4A）
- 批量粘贴、并发下载、断点重试、重名自动改名
- 图集一键合成 PDF
- 历史记录 / 本地图库 / 收藏 / 隐私锁（PIN 或生物识别）
- 9 种界面语言
- 新增：**本地 HTTP API**，可被脚本或其他程序调用

## 快速开始

```bash
npm install
npm start
# 打开 http://127.0.0.1:8787
```

CLI：

```bash
node cli/index.js "https://www.bilibili.com/video/BVxxxx"
node cli/index.js "<URL>" -a          # 只要音频
node cli/index.js "<URL>" -p          # 图集合成 PDF
node cli/index.js "<URL>" -o ./out    # 指定目录
```

移动端 / 桌面端（需要对应工具链）：

```bash
npx cap sync android && cd android && ./gradlew assembleDebug
npx tauri build        # 需要 Rust
```

## HTTP API

服务默认只监听 `127.0.0.1`，所有接口均为同源 JSON。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 版本、抓取核心版本、支持的平台 |
| GET | `/api/platforms` | 每个平台可选的解析服务器 |
| POST | `/api/scrape` | `{ "url": "...", "server": "auto" }` → 媒体列表 |
| POST | `/api/resolve` | 把令牌化中间链接换成直链 |
| POST | `/api/http` | 受控 HTTP 代理（前端 Web 模式使用） |
| GET | `/api/download?url=&filename=` | 服务端流式下载，自动补 Referer |

示例：

```bash
curl -s http://127.0.0.1:8787/api/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.tiktok.com/@user/video/123"}'
```

## 与上游的主要差异

1. **移除在线热更新（重要）**：上游会把 GitHub `main` 上的 `bundle.js` 下载到本地，随后在 WebView / Node 里直接执行，且不校验签名或哈希。本分支删除了这条链路，抓取核心只随版本发布。
2. **新增自托管 Web 服务**：`server/index.js` 提供静态页面、抓取、代理与流式下载；前端在浏览器中自动切换到 `/api/*`。
3. **服务端安全默认值**：只监听本机；`/api/http` 与 `/api/download` 拒绝内网/回环/链路本地地址（防 SSRF），限制响应体大小与超时。
4. **品牌与目录调整**：界面改为「视频爬取」，下载目录改为 `Download/VideoPaqu`；内部 localStorage 键、Android 包名与 JNI 符号保持不变以维持二进制兼容。
5. **移除营销页与上游安装文档**：`landing/`、`GUIDE.md`、`CONTRIBUTING.md` 未包含在本仓库。

## 目录结构

```
public/          前端（Capacitor/Tauri/浏览器共用）
  js/scrapers/   抓取引擎与各平台实现
  js/downloader/ 解析、请求头、落盘
server/index.js  自托管 Web 服务与 API
cli/             Node CLI
android/ ios/    Capacitor 原生工程
src-tauri/       Tauri 桌面工程
```

## 安全与隐私

- 解析链接时，URL 会被发送给对应的第三方解析站点（SnapSave、ytDown 等），这是该工具的工作方式。
- 服务端 API 具备 SSRF 防护，但仍是本机工具：**不要把 `HOST` 设为 `0.0.0.0` 后暴露到公网**。
- 隐私锁的 PIN 仅做本地哈希校验，用于防同事/家人，不构成对抗取证的安全边界。

## 免责声明

请只下载你有权保存的内容，并遵守目标平台的服务条款与当地法律。项目作者不对使用者的行为负责。

## 许可

GPL-3.0-or-later。见 [LICENSE](LICENSE)、[NOTICE](NOTICE)。
