import fs from "fs";
import os from "os";
import path from "path";
import { exec, execSync } from "child_process";
import { fileURLToPath } from "url";
import { DOMParser } from "linkedom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

// 1. Polyfill browser / native globals for scraper bundle
globalThis.window = globalThis;
globalThis.DOMParser = DOMParser;

const mockStorage = new Map([
  ["mori_request_timeout", "30"],
  ["mori_header_spoofing", "true"],
  ["mori_bypass_ssl", "false"],
  ["mori_force_ipv4", "false"],
  ["mori_doh", "off"],
]);

globalThis.localStorage = {
  getItem: (key) => (mockStorage.has(key) ? mockStorage.get(key) : null),
  setItem: (key, val) => mockStorage.set(key, String(val)),
  removeItem: (key) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

const CHROME_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const CHROME_MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
export const CHROME_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36";

function getUserAgent() {
  return CHROME_UA;
}

function getCookiesFromHeaders(headers) {
  const raw = headers["Set-Cookie"] || headers["set-cookie"] || "";
  if (!raw) return "";
  if (Array.isArray(raw)) return raw.map((c) => c.split(";")[0]).join("; ");
  return raw
    .split(/,(?=\s*[^;,=]+=[^;]*)/)
    .map((c) => c.trim().split(";")[0])
    .filter((c) => c && c.includes("="))
    .join("; ");
}

function serializeData(obj) {
  return Object.keys(obj)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]))
    .join("&");
}

function cleanUrl(u) {
  return u ? u.split("?")[0] : "";
}

globalThis.window.__moriDeps = {
  utils: {
    CHROME_UA,
    CHROME_DESKTOP_UA,
    CHROME_MOBILE_UA,
    getUserAgent,
    cleanUrl,
    getCookiesFromHeaders,
    serializeData,
  },
  urlUtils: {
    getCleanUrl: (u) => (u ? u.trim() : ""),
    cleanUrl,
    extractCleanUrl: (text) => {
      if (!text || typeof text !== "string") return "";
      const match = text.match(/https?:\/\/[^\s]+/i);
      return match ? match[0] : text.trim();
    },
  },
  core: {
    t: (k) => k,
  },
};

// 2. Persistent User Configuration & History
export const CONFIG_DIR = path.join(os.homedir(), ".videopaque");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const HISTORY_PATH = path.join(CONFIG_DIR, "history.json");
export const DEFAULT_DOWNLOAD_DIR = path.join(
  os.homedir(),
  "Downloads",
  "VideoPaqu",
);

export function getSavedConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    } catch (_) {}
  }
  return {};
}

export function saveConfig(updates) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const current = getSavedConfig();
  const merged = { ...current, ...updates };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

export function openDirectory(dirPath) {
  const plat = process.platform;
  const cmd =
    plat === "darwin"
      ? `open "${dirPath}"`
      : plat === "win32"
        ? `start "" "${dirPath}"`
        : `xdg-open "${dirPath}"`;
  return new Promise((resolve, reject) => {
    exec(cmd, (err) => (err ? reject(err) : resolve()));
  });
}

export function readClipboard() {
  const plat = process.platform;
  let cmd = "";
  if (plat === "darwin") {
    cmd = "pbpaste";
  } else if (plat === "win32") {
    cmd = 'powershell.exe -NoProfile -Command "Get-Clipboard"';
  } else {
    cmd =
      "which wl-paste >/dev/null 2>&1 && wl-paste || xclip -selection clipboard -o 2>/dev/null || xsel -b -o 2>/dev/null";
  }
  return new Promise((resolve) => {
    exec(cmd, { encoding: "utf8", timeout: 2000 }, (err, stdout) => {
      if (err || !stdout) return resolve("");
      resolve(stdout.trim());
    });
  });
}

export function decodeHtmlEntities(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

export function getNonCollidingPath(dir, filename) {
  let fullPath = path.join(dir, filename);
  if (!fs.existsSync(fullPath)) return fullPath;

  const ext = path.extname(filename);
  const name = path.basename(filename, ext);
  let count = 1;
  while (fs.existsSync(path.join(dir, `${name}_${count}${ext}`))) {
    count++;
  }
  return path.join(dir, `${name}_${count}${ext}`);
}

export function extractUrls(text) {
  if (!text || typeof text !== "string") return [];
  const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return [...new Set(matches)];
}

export function getHistory(limit = 15) {
  if (fs.existsSync(HISTORY_PATH)) {
    try {
      const list = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
      return Array.isArray(list) ? list.slice(0, limit) : [];
    } catch (_) {}
  }
  return [];
}

export function addToHistory(item) {
  try {
    const list = getHistory(100);
    const record = {
      url: item.url || "",
      title: item.title || "Untitled",
      platform: item.platform || "Unknown",
      filename: item.filename || "",
      path: item.path || "",
      bytes: item.bytes || 0,
      timestamp: Date.now(),
    };
    list.unshift(record);
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(
      HISTORY_PATH,
      JSON.stringify(list.slice(0, 100), null, 2),
      "utf8",
    );
  } catch (_) {}
}

export function clearHistory() {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      fs.unlinkSync(HISTORY_PATH);
    }
    return true;
  } catch (_) {
    return false;
  }
}

export function deleteHistoryItem(index, deleteFile = true) {
  try {
    const list = getHistory(200);
    if (index < 0 || index >= list.length) {
      return { success: false, error: "Index out of range" };
    }
    const [removed] = list.splice(index, 1);
    let fileDeleted = false;

    if (deleteFile && removed.path && fs.existsSync(removed.path)) {
      try {
        fs.unlinkSync(removed.path);
        fileDeleted = true;
      } catch (_) {}
    }

    fs.writeFileSync(HISTORY_PATH, JSON.stringify(list, null, 2), "utf8");

    return {
      success: true,
      item: removed,
      fileDeleted,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function getStats() {
  const items = getHistory(200);
  const totalDownloads = items.length;
  const platformCounts = {};
  let totalBytes = 0;

  for (const item of items) {
    const plat = (item.platform || "unknown").toLowerCase();
    platformCounts[plat] = (platformCounts[plat] || 0) + 1;
    if (item.bytes && typeof item.bytes === "number") {
      totalBytes += item.bytes;
    } else if (item.path && fs.existsSync(item.path)) {
      try {
        totalBytes += fs.statSync(item.path).size;
      } catch (_) {}
    }
  }

  let topPlatform = "-";
  let maxCount = 0;
  for (const [p, c] of Object.entries(platformCounts)) {
    if (c > maxCount) {
      maxCount = c;
      topPlatform = p;
    }
  }

  return {
    totalDownloads,
    totalBytes,
    topPlatform,
    platformCounts,
  };
}

// 3. OTA Hot-Patching Engine
const GITHUB_REPO = "coflyn/Mori";
const OTA_DIR = CONFIG_DIR;
export const OTA_BUNDLE_PATH = path.join(OTA_DIR, "scrapers-bundle.js");
export const OTA_META_PATH = path.join(OTA_DIR, "scrapers-meta.json");

export function resetMori() {
  const filesToDelete = [
    CONFIG_PATH,
    HISTORY_PATH,
    OTA_BUNDLE_PATH,
    OTA_META_PATH,
  ];
  for (const f of filesToDelete) {
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
      } catch (_) {}
    }
  }
}

export const OTA_VERSION_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/public/scrapers-version.json`;
export const OTA_BUNDLE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/public/js/scrapers/bundle.js`;

function getBundledVersion() {
  const localMetaPath = path.join(__dirname, "scrapers-version.json");
  const rootMetaPath = path.join(ROOT_DIR, "public/scrapers-version.json");
  const bundledMetaPath = fs.existsSync(localMetaPath)
    ? localMetaPath
    : rootMetaPath;

  if (fs.existsSync(bundledMetaPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(bundledMetaPath, "utf8"));
      return data.scraperVersion || 1;
    } catch (_) {}
  }
  return 1;
}

export function getActiveScraperVersion() {
  if (fs.existsSync(OTA_META_PATH)) {
    try {
      const meta = JSON.parse(fs.readFileSync(OTA_META_PATH, "utf8"));
      if (meta.scraperVersion && meta.scraperVersion >= getBundledVersion()) {
        return meta.scraperVersion;
      }
    } catch (_) {}
  }
  return getBundledVersion();
}

/**
 * Checks for OTA updates from GitHub raw.
 * If force=true, checks immediately and throws on failure.
 * If force=false, checks silently with low timeout (2s).
 */
export async function checkForOtaUpdate(force = false) {
  // 视频爬取：在线热更新已禁用。上游会下载远程 JS 并 eval，且不校验签名；
  // 本分支只使用随包发布的 bundle.js，更新随版本发布。
  return {
    updated: false,
    currentVersion: getActiveScraperVersion(),
    latest: true,
    disabled: true,
  };
}

async function legacyCheckForOtaUpdate(force = false) {
  try {
    const metaRes = await fetch(OTA_VERSION_URL, {
      signal: AbortSignal.timeout(force ? 8000 : 2500),
      headers: { "User-Agent": "VideoPaqu-CLI-OTA", "Cache-Control": "no-cache" },
    });
    if (!metaRes.ok) return { updated: false, reason: "Fetch error" };

    const remoteMeta = await metaRes.json();
    const currentVer = getActiveScraperVersion();

    if (remoteMeta.scraperVersion && remoteMeta.scraperVersion > currentVer) {
      // Pull new bundle
      const bundleRes = await fetch(OTA_BUNDLE_URL, {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Mori-CLI-OTA", "Cache-Control": "no-cache" },
      });
      if (!bundleRes.ok)
        return { updated: false, reason: "Bundle download error" };

      const bundleText = await bundleRes.text();
      if (!bundleText || bundleText.length < 5000) {
        return { updated: false, reason: "Invalid bundle payload" };
      }

      if (!fs.existsSync(OTA_DIR)) {
        fs.mkdirSync(OTA_DIR, { recursive: true });
      }

      fs.writeFileSync(OTA_BUNDLE_PATH, bundleText, "utf8");
      fs.writeFileSync(
        OTA_META_PATH,
        JSON.stringify(
          {
            scraperVersion: remoteMeta.scraperVersion,
            updatedAt: Date.now(),
            sourceHash: remoteMeta.sourceHash || "",
            changelog: remoteMeta.changelog || "",
          },
          null,
          2,
        ),
        "utf8",
      );

      return {
        updated: true,
        oldVersion: currentVer,
        newVersion: remoteMeta.scraperVersion,
        changelog: remoteMeta.changelog || "",
      };
    }

    return { updated: false, currentVersion: currentVer, latest: true };
  } catch (err) {
    if (force) throw err;
    return { updated: false, error: err.message };
  }
}

// 3. Load Scraper Core (OTA Patch > Bundled Asset, with Safe-Mode Recovery)
function loadScraperEngine() {
  const localBundlePath = path.join(__dirname, "bundle.js");
  const rootBundlePath = path.join(ROOT_DIR, "public/js/scrapers/bundle.js");
  const bundledBundlePath = fs.existsSync(localBundlePath)
    ? localBundlePath
    : rootBundlePath;

  // 视频爬取：不再加载 ~/.mori/scrapers-bundle.js 之类的远程补丁。
  // 只执行随包发布的 bundle.js，避免「下载即执行」的供应链风险。

  // Attempt B: Bundled fallback
  if (!fs.existsSync(bundledBundlePath)) {
    throw new Error(
      `Scraper bundle not found at ${bundledBundlePath}. Run npm run compile:scrapers.`,
    );
  }

  const bundleCode = fs.readFileSync(bundledBundlePath, "utf8");
  (0, eval)(bundleCode);

  if (!globalThis.__MoriCoreScrapers) {
    throw new Error("Failed to initialize __MoriCoreScrapers from bundle.");
  }
  return globalThis.__MoriCoreScrapers;
}

export const scrapers = loadScraperEngine();

// 4. Platform Detection
export function detectPlatform(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const url = rawUrl.toLowerCase();
  if (url.includes("tiktok.com")) return "tiktok";
  if (url.includes("instagram.com")) return "instagram";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (
    url.includes("twitter.com") ||
    /(?:^|[/.])x\.com(?:[/?#:]|$)/.test(url) ||
    url.includes("fxtwitter.com") ||
    url.includes("vxtwitter.com") ||
    url.includes("fixupx.com")
  )
    return "twitter";
  if (url.includes("spotify.com")) return "spotify";
  if (url.includes("pinterest.com") || url.includes("pin.it"))
    return "pinterest";
  if (url.includes("music.apple.com")) return "applemusic";
  if (url.includes("facebook.com") || url.includes("fb.watch"))
    return "facebook";
  if (
    url.includes("xiaohongshu.com") ||
    url.includes("rednote.com") ||
    url.includes("xhslink.com") ||
    url.includes("xhslink.cn")
  )
    return "rednote";
  if (url.includes("douyin.com")) return "douyin";
  if (
    url.includes("bilibili.com") ||
    url.includes("b23.tv") ||
    url.includes("bili.im") ||
    url.includes("bilibili.tv")
  )
    return "bilibili";
  if (url.includes("threads.net") || url.includes("threads.com"))
    return "threads";
  if (url.includes("bandcamp.com")) return "bandcamp";
  if (url.includes("pixiv.net")) return "pixiv";
  if (url.includes("reddit.com") || url.includes("redd.it")) return "reddit";
  if (
    url.includes("terabox") ||
    url.includes("1024tera") ||
    url.includes("nephobox") ||
    url.includes("4funbox") ||
    url.includes("mirrobox") ||
    url.includes("momerybox") ||
    url.includes("tibibox")
  )
    return "terabox";
  return null;
}

export const PLATFORM_SERVERS = {
  tiktok: [
    { id: "auto", name: "Auto (Server 1 → Server 2 fallback)" },
    { id: "server1", name: "Server 1 (TikTokIO)" },
    { id: "server2", name: "Server 2 (TikDownloader)" },
  ],
  instagram: [
    { id: "auto", name: "Auto (Server 1 → Server 2 fallback)" },
    { id: "server1", name: "Server 1 (InDown)" },
    { id: "server2", name: "Server 2 (SnapSave)" },
  ],
  youtube: [
    { id: "auto", name: "Auto (Server 1 → Server 2 fallback)" },
    { id: "server1", name: "Server 1 (ytmp3.gg)" },
    { id: "server2", name: "Server 2 (ytmp3.mobi)" },
  ],
  twitter: [
    { id: "auto", name: "Auto (Server 1 → Server 2 fallback)" },
    { id: "server1", name: "Server 1 (TwitterVideoDownloader)" },
    { id: "server2", name: "Server 2 (SaveTWT)" },
  ],
  spotify: [
    { id: "auto", name: "Auto (Server 1 → Server 2 fallback)" },
    { id: "server1", name: "Server 1 (SpotiDown)" },
    { id: "server2", name: "Server 2 (SoundLoaders)" },
  ],
};

// 5. Unified Scraper with Automatic Server Fallbacks
export async function scrapeUrl(url, serverPreference = "auto") {
  const platform = detectPlatform(url);
  if (!platform) {
    throw new Error("URL is not supported by 视频爬取.");
  }

  // Normalize server input (e.g. "1" -> "server1", "2" -> "server2")
  let srv = serverPreference;
  if (srv === "1") srv = "server1";
  if (srv === "2") srv = "server2";

  let res = null;

  switch (platform) {
    case "tiktok": {
      if (srv === "server2") {
        scrapers.setTikTokSource("tikdownloader");
        res = await scrapers.scrapeTikTok(url);
      } else if (srv === "server1") {
        scrapers.setTikTokSource("tiktokio");
        res = await scrapers.scrapeTikTok(url);
      } else {
        scrapers.setTikTokSource("tiktokio");
        res = await scrapers.scrapeTikTok(url);
        if (!res?.status) {
          scrapers.setTikTokSource("tikdownloader");
          res = await scrapers.scrapeTikTok(url);
        }
      }
      break;
    }
    case "instagram": {
      if (srv === "server2") {
        scrapers.setInstagramSource("savevid");
        res = await scrapers.scrapeInstagram(url);
      } else if (srv === "server1") {
        scrapers.setInstagramSource("indown");
        res = await scrapers.scrapeInstagram(url);
      } else {
        scrapers.setInstagramSource("indown");
        res = await scrapers.scrapeInstagram(url);
        if (!res?.status) {
          scrapers.setInstagramSource("savevid");
          res = await scrapers.scrapeInstagram(url);
        }
      }
      break;
    }
    case "youtube": {
      if (srv === "server2") {
        scrapers.setYouTubeSource("mobi");
        res = await scrapers.scrapeYouTube(url);
      } else if (srv === "server1") {
        scrapers.setYouTubeSource("gg");
        res = await scrapers.scrapeYouTube(url);
      } else {
        scrapers.setYouTubeSource("gg");
        res = await scrapers.scrapeYouTube(url);
        if (!res?.status) {
          scrapers.setYouTubeSource("mobi");
          res = await scrapers.scrapeYouTube(url);
        }
      }
      break;
    }
    case "twitter": {
      if (srv === "server2") {
        scrapers.setTwitterSource("savetwt");
        res = await scrapers.scrapeTwitter(url);
      } else if (srv === "server1") {
        scrapers.setTwitterSource("tvd");
        res = await scrapers.scrapeTwitter(url);
      } else {
        scrapers.setTwitterSource("tvd");
        res = await scrapers.scrapeTwitter(url);
        if (!res?.status) {
          scrapers.setTwitterSource("savetwt");
          res = await scrapers.scrapeTwitter(url);
        }
      }
      break;
    }
    case "spotify": {
      if (srv === "server2") {
        scrapers.setSpotifySource("soundloaders");
        res = await scrapers.scrapeSpotify(url);
      } else if (srv === "server1") {
        scrapers.setSpotifySource("spotidown");
        res = await scrapers.scrapeSpotify(url);
      } else {
        scrapers.setSpotifySource("spotidown");
        res = await scrapers.scrapeSpotify(url);
        if (!res?.status) {
          scrapers.setSpotifySource("soundloaders");
          res = await scrapers.scrapeSpotify(url);
        }
      }
      break;
    }
    case "pinterest":
      res = await scrapers.scrapePinterest(url);
      break;
    case "applemusic":
      res = await scrapers.scrapeAppleMusic(url);
      break;
    case "facebook":
      res = await scrapers.scrapeFacebook(url);
      break;
    case "rednote":
      res = await scrapers.scrapeRedNote(url);
      break;
    case "douyin":
      res = await scrapers.scrapeDouyin(url);
      break;
    case "bilibili":
      res = await scrapers.scrapeBilibili(url);
      break;
    case "threads":
      res = await scrapers.scrapeThreads(url);
      break;
    case "bandcamp":
      res = await scrapers.scrapeBandcamp(url);
      break;
    case "pixiv":
      res = await scrapers.scrapePixiv(url);
      break;
    case "reddit":
      res = await scrapers.scrapeReddit(url);
      break;
    case "terabox":
      res = await scrapers.scrapeTeraBox(url);
      break;
    default:
      throw new Error(`Platform handler missing for ${platform}`);
  }

  if (!res || !res.status) {
    throw new Error(res?.message || `Failed to scrape media from ${platform}.`);
  }

  const result = res.result || {};
  if (result.title) {
    result.title = decodeHtmlEntities(result.title);
  }

  return {
    platform,
    ...result,
  };
}

// 6. Asynchronous Direct URL Resolvers
export async function resolveUrl(url, onStatus) {
  if (url.startsWith("applemusic_resolve:")) {
    if (onStatus) onStatus("Resolving Apple Music direct stream...");
    const payloadStr = url.replace("applemusic_resolve:", "");
    const res = await scrapers.scraperFetch({
      method: "POST",
      url: "https://aplmate.com/action/track",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": CHROME_UA,
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://aplmate.com/",
        Origin: "https://aplmate.com",
      },
      data: payloadStr,
    });
    let dd = typeof res === "string" ? JSON.parse(res) : res;
    let dlHtml = (typeof dd === "object" ? dd?.data : dd) || "";
    const parser = new DOMParser();
    const doc = parser.parseFromString(dlHtml, "text/html");
    let foundLink = "";
    doc.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href");
      const text = a.textContent.trim();
      if (
        href &&
        (href.includes("/dl?token=") || a.classList?.contains("abutton"))
      ) {
        if (
          !href.includes("ko-fi.com") &&
          !href.includes("premium.html") &&
          !text.toLowerCase().includes("another song")
        ) {
          if (!foundLink)
            foundLink = href.startsWith("http")
              ? href
              : "https://aplmate.com" + href;
        }
      }
    });
    if (!foundLink)
      throw new Error("Could not resolve Apple Music download link.");
    return foundLink;
  }

  if (url.startsWith("spotidown_resolve:")) {
    if (onStatus) onStatus("Resolving Spotify direct track...");
    const parts = url.replace("spotidown_resolve:", "").split("|||");
    const payloadStr = parts[0];
    let cookiesStr = parts[1] ? decodeURIComponent(parts[1]) : "";

    const reqHeaders = {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": CHROME_UA,
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://spotidown.app/",
      Origin: "https://spotidown.app",
    };
    if (cookiesStr) reqHeaders["Cookie"] = cookiesStr;

    const res = await scrapers.scraperFetch({
      url: "https://spotidown.app/action/track",
      method: "POST",
      headers: reqHeaders,
      data: payloadStr,
      rawResponse: true,
    });
    let dd = res?.data ?? res;
    if (typeof dd === "string") {
      try {
        dd = JSON.parse(dd);
      } catch (_) {}
    }
    let dlHtml = (typeof dd === "object" ? dd?.data || dd?.html : dd) || "";
    const parser = new DOMParser();
    const doc = parser.parseFromString(dlHtml, "text/html");
    let foundLink = "";
    doc.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href");
      const text = a.textContent.trim();
      if (
        href &&
        href.startsWith("http") &&
        !href.includes("premium.html") &&
        text !== "Download Another Song"
      ) {
        if (!foundLink) foundLink = href;
      }
    });
    if (!foundLink) throw new Error("Could not resolve Spotify download link.");
    return foundLink;
  }

  if (
    url.startsWith("youtube_resolve:") ||
    url.startsWith("ytmp3gg_resolve:")
  ) {
    if (onStatus) onStatus("Resolving YouTube audio via converter...");
    const raw = url.startsWith("youtube_resolve:")
      ? url.replace("youtube_resolve:", "")
      : url.replace("ytmp3gg_resolve:", "");
    const [ytId, format = "mp3"] = raw.split("|||");

    const mobiHeaders = {
      Origin: "https://ytmp3.mobi",
      Referer: "https://ytmp3.mobi/en8/",
      "User-Agent": CHROME_UA,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
      Accept: "*/*",
    };

    const initData = await scrapers.scraperFetch({
      url: `https://a.ymcdn.org/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`,
      headers: mobiHeaders,
    });

    if (initData && !initData.error && initData.convertURL) {
      let convData = await scrapers.scraperFetch({
        url: `${initData.convertURL}&v=${ytId}&f=${format}&_=${Math.random()}`,
        headers: mobiHeaders,
      });

      while (convData && convData.redirect > 0 && convData.redirectURL) {
        convData = await scrapers.scraperFetch({
          url: `${convData.redirectURL}&v=${ytId}&f=${format}&_=${Math.random()}`,
          headers: mobiHeaders,
        });
      }

      if (convData && !convData.error) {
        let dlUrl = convData.downloadURL;
        let progUrl = convData.progressURL;
        let progress = 0;
        let attempts = 0;

        while (progress < 3 && attempts < 25) {
          await new Promise((r) => setTimeout(r, 1200));
          const pData = await scrapers.scraperFetch({
            url: `${progUrl}&_=${Math.random()}`,
            headers: mobiHeaders,
          });
          if (pData && !pData.error) {
            progress = pData.progress;
            if (pData.downloadURL) dlUrl = pData.downloadURL;
            if (progress >= 3) break;
          }
          attempts++;
        }

        if (dlUrl && progress >= 3) {
          if (dlUrl.startsWith("//")) dlUrl = "https:" + dlUrl;
          if (dlUrl.startsWith("/")) dlUrl = "https://ytmp3.mobi" + dlUrl;
          return dlUrl;
        }
      }
    }
    throw new Error("YouTube direct conversion timed out or failed.");
  }

  return url;
}

// 7. Filename Sanitizer
export function sanitizeFilename(title, ext = "mp4") {
  const decoded = decodeHtmlEntities(title || "VideoPaqu_Download");
  const safe = decoded
    .replace(/[\\/:*?"<>|#%&{}\[\]@$^+=~`';,]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .trim()
    .substring(0, 75);
  const cleanExt = ext.replace(/^\./, "");
  return `${safe || "Media"}.${cleanExt}`;
}

// 8. Stream Downloader with Progress Reporting
export async function downloadMediaFile(downloadUrl, outputPath, onProgress) {
  const res = await fetch(downloadUrl, {
    headers: {
      "User-Agent": CHROME_UA,
      Accept: "*/*",
    },
  });

  if (!res.ok) {
    throw new Error(`Download HTTP error: ${res.status} ${res.statusText}`);
  }

  const totalBytes = parseInt(res.headers.get("content-length") || "0", 10);
  const fileStream = fs.createWriteStream(outputPath);

  let downloadedBytes = 0;
  let startTime = Date.now();
  let lastReport = 0;

  if (res.body?.getReader) {
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      downloadedBytes += value.length;
      fileStream.write(Buffer.from(value));

      const now = Date.now();
      if (now - lastReport > 150 || downloadedBytes === totalBytes) {
        lastReport = now;
        const elapsedSec = (now - startTime) / 1000 || 0.001;
        const speedBps = downloadedBytes / elapsedSec;
        if (onProgress) {
          onProgress({
            downloadedBytes,
            totalBytes,
            percent: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0,
            speedBps,
          });
        }
      }
    }
    fileStream.end();
  } else {
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    if (onProgress) {
      onProgress({
        downloadedBytes: buffer.length,
        totalBytes: buffer.length,
        percent: 100,
        speedBps: buffer.length,
      });
    }
  }

  return outputPath;
}

// 9. Media & Network Utilities

export function openFile(filePath) {
  const plat = process.platform;
  const cmd =
    plat === "darwin"
      ? `open "${filePath}"`
      : plat === "win32"
        ? `start "" "${filePath}"`
        : `xdg-open "${filePath}"`;
  return new Promise((resolve, reject) => {
    exec(cmd, (err) => (err ? reject(err) : resolve()));
  });
}

export async function pingNetwork(host = "1.1.1.1") {
  const cleanHost = (host || "1.1.1.1")
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0];
  const isWin = process.platform === "win32";
  const cmd = isWin
    ? `ping -n 3 -w 2000 ${cleanHost}`
    : `ping -c 3 -W 2 ${cleanHost}`;

  return new Promise((resolve) => {
    exec(cmd, { encoding: "utf8", timeout: 8000 }, (err, stdout) => {
      if (!err && stdout) {
        const unixMatch = stdout.match(
          /(?:round-trip|rtt)[^=]*=\s*([0-9.]+)\/([0-9.]+)\/([0-9.]+)/i,
        );
        const winMatch = stdout.match(
          /Minimum\s*=\s*([0-9]+)ms.*Maximum\s*=\s*([0-9]+)ms.*Average\s*=\s*([0-9]+)ms/i,
        );
        const lossMatch =
          stdout.match(/([0-9.]+)%\s*packet loss/i) ||
          stdout.match(/loss\s*\(([0-9.]+)%/i);
        const loss = lossMatch ? `${lossMatch[1]}%` : "0%";

        if (unixMatch) {
          return resolve({
            host: cleanHost,
            avg: Math.round(parseFloat(unixMatch[2])),
            min: Math.round(parseFloat(unixMatch[1])),
            max: Math.round(parseFloat(unixMatch[3])),
            loss,
            ok: true,
          });
        }
        if (winMatch) {
          return resolve({
            host: cleanHost,
            avg: parseInt(winMatch[3], 10),
            min: parseInt(winMatch[1], 10),
            max: parseInt(winMatch[2], 10),
            loss,
            ok: true,
          });
        }
      }

      // Fallback: fast HTTP latency check if ICMP blocked
      const start = Date.now();
      fetch(`https://${cleanHost}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(3000),
      })
        .then(() => {
          const ms = Date.now() - start;
          resolve({
            host: cleanHost,
            avg: ms,
            min: ms,
            max: ms,
            loss: "0%",
            ok: true,
          });
        })
        .catch(() => {
          resolve({
            host: cleanHost,
            avg: -1,
            min: -1,
            max: -1,
            loss: "100%",
            ok: false,
          });
        });
    });
  });
}

// 10. Native Zero-Dependency Multi-Image PDF 1.4 Builder

export function ensureJpegBuffer(buf) {
  if (!buf || buf.length < 4) return buf;
  // If already JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    return buf;
  }
  // Convert via sips on macOS if available
  if (process.platform === "darwin") {
    try {
      const tmpIn = path.join(
        os.tmpdir(),
        `mori_convert_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`,
      );
      const tmpOut = `${tmpIn}.jpg`;
      fs.writeFileSync(tmpIn, buf);
      execSync(
        `sips -s format jpeg "${tmpIn}" --out "${tmpOut}" >/dev/null 2>&1`,
      );
      if (fs.existsSync(tmpOut)) {
        const outBuf = fs.readFileSync(tmpOut);
        try {
          fs.unlinkSync(tmpIn);
        } catch (_) {}
        try {
          fs.unlinkSync(tmpOut);
        } catch (_) {}
        return outBuf;
      }
    } catch (_) {}
  }
  // Fallback: try ffmpeg if installed
  try {
    const tmpIn = path.join(
      os.tmpdir(),
      `mori_convert_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`,
    );
    const tmpOut = `${tmpIn}.jpg`;
    fs.writeFileSync(tmpIn, buf);
    execSync(`ffmpeg -y -i "${tmpIn}" "${tmpOut}" >/dev/null 2>&1`);
    if (fs.existsSync(tmpOut)) {
      const outBuf = fs.readFileSync(tmpOut);
      try {
        fs.unlinkSync(tmpIn);
      } catch (_) {}
      try {
        fs.unlinkSync(tmpOut);
      } catch (_) {}
      return outBuf;
    }
  } catch (_) {}

  return buf;
}

export function getImageDimensions(buf) {
  if (!buf || buf.length < 8) return { width: 595, height: 842 };

  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset < buf.length - 8) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1];
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return {
            height: buf.readUInt16BE(offset + 5),
            width: buf.readUInt16BE(offset + 7),
          };
        }
      }
      const len = buf.readUInt16BE(offset + 2);
      offset += 2 + len;
    }
  }

  // PNG
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf.length >= 24
  ) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }

  return { width: 595, height: 842 };
}

export function generateImagesPdf(images) {
  // images: array of { buffer, width, height }
  const pageObjIds = images.map((_, i) => 3 + i * 3);

  const obj1 = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${images.length} >>\nendobj\n`;

  const parts = [
    Buffer.from("%PDF-1.4\n"),
    Buffer.from(obj1),
    Buffer.from(obj2),
  ];

  const offsets = [];
  const totalObjs = 2 + images.length * 3;
  let currentOffset = "%PDF-1.4\n".length;

  offsets.push(0);
  offsets.push(currentOffset);
  currentOffset += Buffer.byteLength(obj1);
  offsets.push(currentOffset);
  currentOffset += Buffer.byteLength(obj2);

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const w = img.width || 595;
    const h = img.height || 842;
    const pageId = 3 + i * 3;
    const imgId = 4 + i * 3;
    const contentId = 5 + i * 3;

    // Page Object
    offsets.push(currentOffset);
    const pageStr = `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`;
    currentOffset += Buffer.byteLength(pageStr);
    parts.push(Buffer.from(pageStr));

    // Image XObject (Raw DCTDecode stream)
    offsets.push(currentOffset);
    const imgHeader = `${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.buffer.length} >>\nstream\n`;
    const imgFooter = "\nendstream\nendobj\n";
    currentOffset +=
      Buffer.byteLength(imgHeader) +
      img.buffer.length +
      Buffer.byteLength(imgFooter);
    parts.push(Buffer.from(imgHeader));
    parts.push(img.buffer);
    parts.push(Buffer.from(imgFooter));

    // Content Stream
    offsets.push(currentOffset);
    const contentData = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    const contentStr = `${contentId} 0 obj\n<< /Length ${contentData.length} >>\nstream\n${contentData}\nendstream\nendobj\n`;
    currentOffset += Buffer.byteLength(contentStr);
    parts.push(Buffer.from(contentStr));
  }

  const startxref = currentOffset;
  let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjs; i++) {
    xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  const trailer = `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  parts.push(Buffer.from(trailer));

  return Buffer.concat(parts);
}

export function compileImagesToPdf(imageBuffers, outputPath) {
  const images = [];
  for (const rawBuf of imageBuffers) {
    const jpegBuf = ensureJpegBuffer(rawBuf);
    const { width, height } = getImageDimensions(jpegBuf);
    images.push({ buffer: jpegBuf, width, height });
  }
  const pdfBuffer = generateImagesPdf(images);
  fs.writeFileSync(outputPath, pdfBuffer);
  return { outputPath, bytes: pdfBuffer.length, pages: images.length };
}
