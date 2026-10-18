// server/index.js — 视频爬取 自托管 Web 服务
// 把 public/ 的前端与 cli/engine.js 的抓取引擎接到同一个进程里：
//   · 浏览器不再受 CORS 限制，所有解析请求由本机代理
//   · 下载由服务端流式转发，解决第三方 CDN 的 Referer / 防盗链限制
//   · 提供 /api/* 供脚本自动化调用
//
// 本文件是 视频爬取 相对上游 Mori 新增的实现，GPL-3.0-or-later。

import express from "express";
import path from "node:path";
import fs from "node:fs";
import dns from "node:dns/promises";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

import {
  scrapeUrl,
  detectPlatform,
  PLATFORM_SERVERS,
  getActiveScraperVersion,
} from "../cli/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");

const APP_NAME = "视频爬取";
const VERSION = "1.0.0";
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";

const MAX_PROXY_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/* ---------------------------------------------------------------- SSRF 防护 */

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  // 注意：198.18.0.0/15 是 Clash / Mihomo 等本地代理常见的 fake-IP 段，
  // 这里刻意不拦截，否则开启 TUN 模式的机器会把所有外网请求判为内网。
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  blocked.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) {
  blocked.addSubnet(addr, prefix, "ipv6");
}

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 0) return true;
  return blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}

/**
 * 校验目标 URL：只允许 http(s)，禁止内网 / 回环 / 链路本地地址。
 * 注意：这能挡住绝大多数 SSRF，但无法完全防御 DNS rebinding（本机工具场景可接受）。
 */
async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw httpError(400, "URL 格式不正确");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw httpError(400, "只支持 http/https");
  }
  if (url.username || url.password) {
    throw httpError(400, "URL 不允许携带账号信息");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw httpError(400, "目标地址不可访问");
  } else {
    let records;
    try {
      records = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
      throw httpError(400, "无法解析目标域名");
    }
    if (!records.length || records.some((r) => isBlockedAddress(r.address))) {
      throw httpError(400, "目标地址不可访问");
    }
  }
  return url;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** 手动跟随重定向，每一跳都重新做 SSRF 校验。 */
async function safeFetch(target, init = {}, maxHops = 5) {
  let url = await assertPublicUrl(target);
  for (let hop = 0; hop <= maxHops; hop++) {
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": UA, ...(init.headers || {}) },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location"), url).toString();
      url = await assertPublicUrl(next);
      continue;
    }
    return { res, finalUrl: url.toString() };
  }
  throw httpError(508, "重定向次数过多");
}

async function readCapped(res, limit = MAX_PROXY_BYTES) {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > limit) throw httpError(413, "响应体过大");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) throw httpError(413, "响应体过大");
  return buf;
}

/* -------------------------------------------------------------------- 应用 */

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: APP_NAME,
    version: VERSION,
    scraperCore: getActiveScraperVersion(),
    platforms: Object.keys(PLATFORM_SERVERS),
  });
});

app.get("/api/platforms", (_req, res) => {
  res.json({ platforms: PLATFORM_SERVERS });
});

/** 把底层网络错误翻译成可读的提示，避免直接把 "fetch failed" 抛给前端。 */
function upstreamError(err, what = "解析服务") {
  if (err?.status) return err;
  const cause = err?.cause?.code || err?.cause?.message || "";
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR/i.test(String(err?.message || "") + cause)) {
    return httpError(
      502,
      `${what}连接失败：目标站点不可达、被网络屏蔽或需要代理（${cause || "network error"}）`,
    );
  }
  return err;
}

/** 解析链接 → 可供下载的媒体列表 */
app.post("/api/scrape", async (req, res, next) => {
  try {
    const { url, server = "auto" } = req.body || {};
    if (!url || typeof url !== "string") throw httpError(400, "缺少 url");
    if (!detectPlatform(url)) throw httpError(400, "暂不支持该链接");
    const result = await scrapeUrl(url.trim(), String(server));
    res.json({ ok: true, platform: result.platform, result });
  } catch (err) {
    next(upstreamError(err, "第三方解析站点"));
  }
});

/** 把 token 化的中间链接换成真正的媒体直链（少数平台需要） */
app.post("/api/resolve", async (req, res, next) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") throw httpError(400, "缺少 url");
    const { resolveUrl } = await import("../cli/engine.js");
    const resolved = await resolveUrl(url);
    res.json({ ok: true, url: resolved });
  } catch (err) {
    next(err);
  }
});

/** 通用 HTTP 代理：浏览器端 scraperFetch 在 Web 模式下走这里 */
app.post("/api/http", async (req, res, next) => {
  try {
    const {
      url,
      method = "GET",
      headers = {},
      data,
      responseType = "text",
    } = req.body || {};
    if (!url || typeof url !== "string") throw httpError(400, "缺少 url");

    const upper = String(method).toUpperCase();
    const init = { method: upper, headers: { ...headers } };
    if (data !== undefined && data !== null && upper !== "GET" && upper !== "HEAD") {
      init.body = typeof data === "string" ? data : JSON.stringify(data);
    }

    const { res: upstream, finalUrl } = await safeFetch(url, init);
    const buf = await readCapped(upstream);
    const outHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (["content-encoding", "transfer-encoding", "content-length"].includes(key)) return;
      outHeaders[key] = value;
    });

    res.json({
      status: upstream.status,
      headers: outHeaders,
      url: finalUrl,
      data: responseType === "arraybuffer" ? buf.toString("base64") : buf.toString("utf8"),
      encoding: responseType === "arraybuffer" ? "base64" : "utf8",
    });
  } catch (err) {
    next(upstreamError(err, "目标站点"));
  }
});

/** 服务端流式下载：处理 Referer / Origin 防盗链，浏览器只负责保存 */
app.get("/api/download", async (req, res, next) => {
  try {
    const { url, filename = "video.mp4", referer } = req.query;
    if (!url || typeof url !== "string") throw httpError(400, "缺少 url");

    const headers = {};
    if (referer) headers.Referer = String(referer);
    else {
      try {
        headers.Referer = new URL(url).origin + "/";
      } catch {}
    }

    const { res: upstream } = await safeFetch(url, { headers });
    if (!upstream.ok) throw httpError(502, `上游返回 ${upstream.status}`);

    const safeName = String(filename)
      .replace(/[\\/:*?"<>|\r\n]/g, "_")
      .slice(0, 120) || "video.mp4";

    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "application/octet-stream",
    );
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    );

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    next(upstreamError(err, "媒体源"));
  }
});

/* -------------------------------------------------------------------- 静态 */

app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    maxAge: "1h",
    setHeaders(res, filePath) {
      if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
    },
  }),
);

app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    return res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  }
  next();
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error("[视频爬取]", err);
  res.status(status).json({ ok: false, error: err.message || "服务器内部错误" });
});

if (!fs.existsSync(path.join(PUBLIC_DIR, "index.html"))) {
  console.error("找不到 public/index.html，请在仓库根目录运行。");
  process.exit(1);
}

app.listen(PORT, HOST, () => {
  console.log(`${APP_NAME} v${VERSION} 已启动  http://${HOST}:${PORT}`);
  console.log(`抓取核心 v${getActiveScraperVersion()} · 仅监听本机时请勿暴露到公网`);
});
