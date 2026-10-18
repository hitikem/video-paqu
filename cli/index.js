#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { parseArgs } from "node:util";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  detectPlatform,
  PLATFORM_SERVERS,
  scrapeUrl,
  resolveUrl,
  sanitizeFilename,
  downloadMediaFile,
  checkForOtaUpdate,
  getActiveScraperVersion,
  getSavedConfig,
  saveConfig,
  openDirectory,
  extractUrls,
  getHistory,
  addToHistory,
  clearHistory,
  deleteHistoryItem,
  readClipboard,
  getNonCollidingPath,
  resetMori,
  getStats,
  DEFAULT_DOWNLOAD_DIR,
  CONFIG_PATH,
  openFile,
  pingNetwork,
  compileImagesToPdf,
  CHROME_UA,
} from "./engine.js";

const APP_VERSION = "1.0.0";

function isNewerVersion(latest, current) {
  if (!latest || !current) return false;
  const l = latest.replace(/^v/, "").split(".").map(Number);
  const c = current.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const lPart = l[i] || 0;
    const cPart = c[i] || 0;
    if (lPart > cPart) return true;
    if (lPart < cPart) return false;
  }
  return false;
}

async function checkCliUpdate() {
  // 视频爬取：CLI 通过 GitHub Releases / 包管理器升级，
  // 不再查询上游 @coflyn/mori 的 npm 版本。
  return null;
}

function formatRelativeTime(ms) {
  if (!ms) return "";
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function renderProgressBar(percent, width = 22) {
  const pVal = Math.max(0, Math.min(100, percent));
  const filled = Math.round((pVal / 100) * width);
  const empty = width - filled;
  return pc.white("█".repeat(filled)) + pc.dim("░".repeat(empty));
}

function printBanner(coreVer) {
  const brand =
    pc.bold(pc.inverse(" 视频爬取 ")) +
    " " +
    pc.bold(`v${APP_VERSION}`) +
    " " +
    pc.dim(`(core v${coreVer})`);
  const sub = pc.dim(
    "VideoPaqu · 多平台视频/音频/图集下载（GPL-3.0 衍生自 Mori）",
  );
  p.intro(`${brand}\n  ${sub}`);
}

function printHelp() {
  console.log(`
${pc.bold(pc.inverse(" 视频爬取 CLI "))} ${pc.bold(`v${APP_VERSION}`)}

${pc.bold("USAGE:")}
  ${pc.white("node cli/index.js")} ${pc.dim("[URL]")} ${pc.dim("[OPTIONS]")}

${pc.bold("OPTIONS:")}
  ${pc.white("-o, --output <dir>")}   Destination folder (default: ${pc.dim("~/Downloads/VideoPaqu")})
  ${pc.white("-s, --server <1|2>")}    Choose scraper server (TikTok, IG, YouTube, X, Spotify)
  ${pc.white("-a, --audio")}           Download audio-only stream (MP3/M4A)
  ${pc.white("-p, --pdf")}             Compile photo album directly into a single PDF
  ${pc.white("-c, --clip")}            Auto-fetch link from system clipboard
  ${pc.white("-y, --yes")}            Download best/first available stream automatically
  ${pc.white("-i, --info")}           Inspect and display media details only
  ${pc.white("-u, --update")}         Check and pull latest OTA scraper patch
  ${pc.white("-h, --help")}           Show this documentation
  ${pc.white("-v, --version")}        Print version number

${pc.bold("SUPPORTED PLATFORMS (16):")}
  ${pc.dim("TikTok • Instagram • YouTube • Twitter/X • Spotify • Pinterest • Facebook")}
  ${pc.dim("Bilibili • Reddit • RedNote • Threads • Pixiv • Bandcamp • Apple Music • Douyin • TeraBox")}

${pc.bold("EXAMPLES:")}
  ${pc.dim("# Interactive")}
  mori

  # Download link directly from clipboard
  mori --clip

  # Download audio-only (MP3)
  mori https://youtu.be/dQw4w9WgXcQ -a

  # Direct link with Server 2
  mori https://www.tiktok.com/@user/video/123456789 -s 2

  # Check OTA scraper updates
  mori --update
`);
}

async function runConcurrentPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const idx = nextIndex++;
        results[idx] = await fn(items[idx], idx);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function processDownloadItem({ item, meta, outputDir, index, total }) {
  const ext =
    item.type?.toLowerCase().includes("mp3") ||
    item.type?.toLowerCase().includes("audio")
      ? "mp3"
      : item.type?.toLowerCase().includes("photo") ||
          item.type?.toLowerCase().includes("image")
        ? "jpg"
        : "mp4";

  let baseTitle = meta.title || "Media";
  if (total > 1) {
    baseTitle = `${baseTitle}_${index + 1}`;
  }
  const filename = sanitizeFilename(baseTitle, ext);
  const destPath = getNonCollidingPath(outputDir, filename);

  const spin = p.spinner();
  spin.start(pc.dim(`Preparing ${pc.bold(filename)}...`));

  let directUrl;
  try {
    directUrl = await resolveUrl(item.url, (msg) => {
      spin.message(pc.dim(msg));
    });
  } catch (err) {
    spin.stop(pc.bold(`✕ Resolve failed: ${err.message}`));
    return false;
  }

  spin.stop(pc.dim(`Downloading ${pc.bold(filename)}...`));

  let finalBytes = 0;
  try {
    await downloadMediaFile(directUrl, destPath, (prog) => {
      finalBytes = prog.downloadedBytes;
      const bar = renderProgressBar(prog.percent, 20);
      const pct = `${prog.percent.toFixed(0)}%`.padStart(4);
      const dl = formatBytes(prog.downloadedBytes);
      const tot = prog.totalBytes > 0 ? formatBytes(prog.totalBytes) : "?";
      const spd = `${formatBytes(prog.speedBps)}/s`;

      const line = `  ${bar} ${pc.bold(pct)} ${pc.dim(`(${dl}/${tot} • ${spd})`)}`;
      process.stdout.write(`\r${line}\x1b[K`);
    });

    process.stdout.write("\r\x1b[2K");
    p.log.message(
      `${pc.bold("● Saved:")} ${pc.bold(path.basename(destPath))} ${pc.dim(`(${path.relative(process.cwd(), destPath)})`)}`,
    );
    addToHistory({
      url: meta.url || "",
      title: meta.title || "Media",
      platform: meta.platform || "unknown",
      filename: path.basename(destPath),
      path: destPath,
      bytes: finalBytes,
    });
    return true;
  } catch (err) {
    process.stdout.write("\r\x1b[2K");
    p.log.error(`Failed to download ${filename}: ${err.message}`);
    return false;
  }
}

async function handleScrapeAndDownload(targetUrl, options) {
  const outputDir = path.resolve(options.output || DEFAULT_DOWNLOAD_DIR);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const platform = detectPlatform(targetUrl);
  if (!platform) {
    p.log.error(`Unsupported URL: ${targetUrl}`);
    return false;
  }

  const savedConfig = getSavedConfig();
  // Dual Server Selection prompt for supported platforms
  let serverChoice = options.server || savedConfig.defaultServer;
  const serverList = PLATFORM_SERVERS[platform];
  const isInteractive = Boolean(process.stdin.isTTY);
  if (
    (!serverChoice || serverChoice === "auto") &&
    serverList &&
    !options.yes &&
    !options.info &&
    isInteractive
  ) {
    const chosen = await p.select({
      message: "Select Server:",
      options: serverList.map((s) => ({
        value: s.id,
        label: s.name,
      })),
      initialValue: "auto",
    });

    if (p.isCancel(chosen)) {
      p.cancel("Cancelled.");
      return false;
    }
    serverChoice = chosen;
  }

  const s = p.spinner();
  s.start(pc.dim("Analyzing link..."));

  let media;
  try {
    media = await scrapeUrl(targetUrl, serverChoice || "auto");
    media.url = targetUrl;
    s.stop(pc.dim("Link analyzed."));
  } catch (err) {
    s.stop(pc.bold(`✕ Extraction failed: ${err.message}`));
    return false;
  }

  // Metadata card with Platform name as title (e.g. TIKTOK, INSTAGRAM)
  const infoLines = [
    `${pc.dim("Title   :")} ${media.title || "Untitled"}`,
    `${pc.dim("Creator :")} ${media.author || "Creator"}`,
    `${pc.dim("Streams :")} ${media.downloads?.length || 0} option(s)`,
  ];
  p.note(infoLines.join("\n"), pc.bold(media.platform.toUpperCase()));

  if (options.info) {
    if (media.downloads?.length) {
      const streamLines = media.downloads.map(
        (d, idx) =>
          `  ${pc.bold(`[${idx + 1}]`)} ${pc.white(d.type || "Stream")} ${d.quality ? pc.dim(`(${d.quality})`) : ""} ${d.isMirror ? pc.dim("[Mirror]") : ""}`,
      );
      p.note(streamLines.join("\n"), pc.dim("Available Streams"));
    }
    return true;
  }

  const downloads = media.downloads || [];
  if (downloads.length === 0) {
    p.log.warn("No active download streams found for this URL.");
    return false;
  }

  if (options.audio) {
    const audioItem =
      downloads.find(
        (d) =>
          d.type?.toLowerCase().includes("mp3") ||
          d.type?.toLowerCase().includes("audio") ||
          d.type?.toLowerCase().includes("music"),
      ) || downloads[0];

    p.log.message(
      `${pc.bold("● Audio Stream:")} ${pc.white(audioItem.type || "MP3")}`,
    );

    await processDownloadItem({
      item: audioItem,
      meta: media,
      outputDir,
      index: 0,
      total: 1,
    });
    return true;
  }

  if (options.yes) {
    await processDownloadItem({
      item: downloads[0],
      meta: media,
      outputDir,
      index: 0,
      total: 1,
    });
    return true;
  }

  const photoDownloads = downloads.filter(
    (d) =>
      d.type?.toLowerCase().includes("photo") ||
      d.type?.toLowerCase().includes("image") ||
      d.type?.toLowerCase().includes("page"),
  );

  const audioDownloads = downloads.filter(
    (d) =>
      d.type?.toLowerCase().includes("audio") ||
      d.type?.toLowerCase().includes("music") ||
      d.type?.toLowerCase().includes("mp3"),
  );

  const isPhotoGallery = photoDownloads.length > 1;
  const isSingleImage = photoDownloads.length === 1 && downloads.length === 1;

  if (options.pdf && isSingleImage) {
    const item = photoDownloads[0];
    const s = p.spinner();
    s.start(pc.dim("Downloading photo for PDF album..."));
    try {
      const res = await fetch(item.url, {
        headers: { "User-Agent": CHROME_UA, Accept: "*/*" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const rawPdfName = sanitizeFilename(media.title || "Photo", "pdf");
      const outPdfPath = getNonCollidingPath(outputDir, rawPdfName);
      const { bytes } = compileImagesToPdf([buf], outPdfPath);
      s.stop(
        pc.bold("✔ Compiled 1-page PDF:") +
          ` ${path.basename(outPdfPath)} (${formatBytes(bytes)})`,
      );
      p.log.step(`${pc.bold("Saved to:")} ${pc.dim(outPdfPath)}`);
      addToHistory({
        url: targetUrl || media.url || "",
        title: media.title || "Photo",
        platform: media.platform || "Photo",
        filename: path.basename(outPdfPath),
        path: outPdfPath,
        bytes,
      });
      return true;
    } catch (err) {
      s.stop(pc.bold(`✕ Failed to download photo: ${err.message}`));
      return false;
    }
  }

  if (isPhotoGallery) {
    let albumFormat = options.pdf ? "pdf" : null;
    let itemsToDownload = photoDownloads;
    let downloadAudioAlso = false;

    if (!albumFormat) {
      const albumOptions = [
        {
          value: "all",
          label: `Download All (${photoDownloads.length} individual images)`,
        },
        {
          value: "pdf",
          label: `Download as PDF Album (${photoDownloads.length} photos in 1 file)`,
        },
      ];

      if (audioDownloads.length > 0) {
        albumOptions.push({
          value: "all_plus_audio",
          label: `Download All + Audio (${photoDownloads.length} photos + MP3)`,
        });
      }

      albumOptions.push({
        value: "custom",
        label: "Select specific photos...",
      });

      if (audioDownloads.length > 0) {
        albumOptions.push({
          value: "audio_only",
          label: "Download Audio Only (MP3)",
        });
      }

      albumOptions.push({
        value: "cancel",
        label: pc.dim("Cancel"),
      });

      const choice = await p.select({
        message: `Photo album detected (${photoDownloads.length} photos${audioDownloads.length > 0 ? " + audio" : ""}):`,
        options: albumOptions,
      });

      if (p.isCancel(choice) || choice === "cancel") {
        p.cancel("Cancelled.");
        return false;
      }

      if (choice === "audio_only") {
        await processDownloadItem({
          item: audioDownloads[0],
          meta: media,
          outputDir,
          index: 0,
          total: 1,
        });
        return true;
      }

      if (choice === "all_plus_audio") {
        albumFormat = "all";
        downloadAudioAlso = true;
      } else if (choice === "pdf") {
        albumFormat = "pdf";
      } else if (choice === "custom") {
        const selectedIndices = await p.multiselect({
          message: "Select photos to download:",
          options: photoDownloads.map((d, i) => ({
            value: i,
            label: `Photo #${i + 1}`,
          })),
          required: true,
        });

        if (p.isCancel(selectedIndices)) {
          p.cancel("Cancelled.");
          return false;
        }

        itemsToDownload = selectedIndices.map((idx) => photoDownloads[idx]);

        const formatChoice = await p.select({
          message: "Save selected photos as:",
          options: [
            {
              value: "all",
              label: `Individual image files (${itemsToDownload.length} files)`,
            },
            {
              value: "pdf",
              label: `Single PDF album (${itemsToDownload.length} photos)`,
            },
          ],
        });

        if (p.isCancel(formatChoice)) {
          p.cancel("Cancelled.");
          return false;
        }
        albumFormat = formatChoice;
      } else {
        albumFormat = "all";
      }
    }

    if (albumFormat === "pdf") {
      const s = p.spinner();
      const total = itemsToDownload.length;
      let completed = 0;
      let totalBytes = 0;

      s.start(pc.dim(`[0/${total}] Fetching photos in parallel...`));

      const rawBuffers = await runConcurrentPool(
        itemsToDownload,
        5,
        async (item, i) => {
          try {
            const directUrl = await resolveUrl(item.url);
            const res = await fetch(directUrl, {
              headers: {
                "User-Agent": CHROME_UA,
                Accept: "*/*",
                ...(item.headers || {}),
              },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            completed++;
            totalBytes += buf.length;
            s.message(
              pc.dim(
                `[${completed}/${total}] Fetching photos... (${formatBytes(totalBytes)})`,
              ),
            );
            return buf;
          } catch (err) {
            completed++;
            s.message(
              pc.dim(
                `[${completed}/${total}] Fetching photos... (${formatBytes(totalBytes)})`,
              ),
            );
            return null;
          }
        },
      );

      const buffers = rawBuffers.filter(Boolean);

      if (buffers.length === 0) {
        s.stop(pc.bold("✕ Failed to download photos for PDF album."));
        return false;
      }

      s.stop(
        pc.bold(`✔ [${buffers.length}/${total}] Photos fetched`) +
          ` (${formatBytes(totalBytes)})`,
      );

      s.start(pc.dim(`Compiling ${buffers.length} photos into PDF album...`));
      const rawPdfName = sanitizeFilename(media.title || "Photo_Album", "pdf");
      const outPdfPath = getNonCollidingPath(outputDir, rawPdfName);

      const { bytes, pages } = compileImagesToPdf(buffers, outPdfPath);
      s.stop(
        pc.bold("✔ PDF Album Created:") +
          ` ${path.basename(outPdfPath)} (${pages} pages, ${formatBytes(bytes)})`,
      );

      addToHistory({
        url: targetUrl || media.url || "",
        title: media.title || "Photo Album",
        platform: media.platform || "Album",
        filename: path.basename(outPdfPath),
        path: outPdfPath,
        bytes,
      });

      p.log.step(`${pc.bold("Saved to:")} ${pc.dim(outPdfPath)}`);

      if (downloadAudioAlso && audioDownloads.length > 0) {
        await processDownloadItem({
          item: audioDownloads[0],
          meta: media,
          outputDir,
          index: 0,
          total: 1,
        });
      }

      return true;
    }

    const s = p.spinner();
    const total = itemsToDownload.length;
    let completed = 0;
    let totalBytes = 0;
    let successCount = 0;

    s.start(pc.dim(`[0/${total}] Downloading photos in parallel...`));

    await runConcurrentPool(itemsToDownload, 5, async (item, i) => {
      const ext =
        item.type?.toLowerCase().includes("mp3") ||
        item.type?.toLowerCase().includes("audio")
          ? "mp3"
          : "jpg";
      let baseTitle = media.title || "Photo";
      if (total > 1) {
        baseTitle = `${baseTitle}_${i + 1}`;
      }
      const filename = sanitizeFilename(baseTitle, ext);
      const destPath = getNonCollidingPath(outputDir, filename);

      try {
        const directUrl = await resolveUrl(item.url);
        let fileBytes = 0;
        await downloadMediaFile(directUrl, destPath, (prog) => {
          fileBytes = prog.downloadedBytes;
        });

        completed++;
        totalBytes += fileBytes;
        successCount++;
        s.message(
          pc.dim(
            `[${completed}/${total}] Downloading photos... (${formatBytes(totalBytes)})`,
          ),
        );

        addToHistory({
          url: targetUrl || media.url || "",
          title: `${media.title || "Photo"} #${i + 1}`,
          platform: media.platform || "Photo",
          filename: path.basename(destPath),
          path: destPath,
          bytes: fileBytes,
        });
      } catch (err) {
        completed++;
        s.message(
          pc.dim(
            `[${completed}/${total}] Downloading photos... (${formatBytes(totalBytes)})`,
          ),
        );
      }
    });

    s.stop(
      pc.bold(`✔ [${successCount}/${total}] Photos downloaded:`) +
        ` Saved to ${pc.dim(outputDir)} (${formatBytes(totalBytes)})`,
    );

    if (downloadAudioAlso && audioDownloads.length > 0) {
      await processDownloadItem({
        item: audioDownloads[0],
        meta: media,
        outputDir,
        index: itemsToDownload.length,
        total: itemsToDownload.length + 1,
      });
    }

    return true;
  } else {
    let selectedItem = downloads[0];

    if (downloads.length > 1) {
      const formatChoice = await p.select({
        message: "Select stream:",
        options: downloads.map((d, i) => ({
          value: i,
          label: pc.bold(d.type || `Stream ${i + 1}`),
          hint: d.quality || (d.isMirror ? "Mirror" : ""),
        })),
      });

      if (p.isCancel(formatChoice)) {
        p.cancel("Cancelled.");
        return false;
      }
      selectedItem = downloads[formatChoice];
    }

    await processDownloadItem({
      item: selectedItem,
      meta: media,
      outputDir,
      index: 0,
      total: 1,
    });
  }

  return true;
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      output: { type: "string", short: "o" },
      server: { type: "string", short: "s" },
      audio: { type: "boolean", short: "a", default: false },
      pdf: { type: "boolean", short: "p", default: false },
      clip: { type: "boolean", short: "c", default: false },
      yes: { type: "boolean", short: "y", default: false },
      info: { type: "boolean", short: "i", default: false },
      update: { type: "boolean", short: "u", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (values.version) {
    console.log(
      `视频爬取 CLI v${APP_VERSION} (core v${getActiveScraperVersion()})`,
    );
    process.exit(0);
  }

  // Handle manual OTA update flag
  if (values.update) {
    const s = p.spinner();
    s.start(pc.dim("Checking remote scraper patch..."));
    try {
      const res = await checkForOtaUpdate(true);
      if (res.updated) {
        s.stop(
          pc.bold(`✔ Scrapers updated to v${res.newVersion}`) +
            (res.changelog ? pc.dim(` — ${res.changelog}`) : ""),
        );
      } else if (res.disabled) {
        s.stop(
          pc.dim(
            "在线热更新已禁用：抓取核心随版本发布，请更新应用本体。",
          ),
        );
      } else {
        s.stop(pc.dim(`Scrapers already up to date (v${res.currentVersion}).`));
      }
    } catch (err) {
      s.stop(pc.bold(`✕ OTA check failed: ${err.message}`));
    }
    process.exit(0);
  }

  const coreVer = getActiveScraperVersion();
  printBanner(coreVer);

  // 视频爬取：不再在后台静默下载并安装远程补丁。
  const cliUpdatePromise = checkCliUpdate();

  const savedConfig = getSavedConfig();
  const defaultDir =
    values.output || savedConfig.outputDir || DEFAULT_DOWNLOAD_DIR;
  let currentOutputDir = path.resolve(defaultDir);

  if (values.clip) {
    const s = p.spinner();
    s.start(pc.dim("Reading clipboard..."));
    const clipText = await readClipboard();
    const urls = extractUrls(clipText);
    const valid = urls.find((u) => Boolean(detectPlatform(u)));
    if (valid) {
      s.stop(
        `${pc.bold("Clipboard link:")} ${pc.inverse(` ${detectPlatform(valid)?.toUpperCase()} `)} ${pc.dim(valid)}`,
      );
      positionals[0] = valid;
    } else {
      s.stop(pc.bold("✕ No supported media URL found in clipboard."));
      process.exit(1);
    }
  }

  let targetUrl = positionals[0];
  let lastUrl = null;

  if (targetUrl) {
    const platform = detectPlatform(targetUrl);
    if (!platform) {
      p.log.error(`Unsupported URL: ${targetUrl}`);
      p.outro(pc.dim("Run with --help to view supported platforms."));
      process.exit(1);
    }

    lastUrl = targetUrl;
    await handleScrapeAndDownload(targetUrl, {
      ...values,
      output: currentOutputDir,
    });
    const newVer = await cliUpdatePromise;
    if (newVer) {
      p.log.message(
        pc.yellow(
          `● Update available: v${APP_VERSION} → v${newVer} (run: npm i -g @coflyn/mori)`,
        ),
      );
    }
    p.outro(pc.dim("Complete."));
  } else {
    const newVer = await cliUpdatePromise;
    if (newVer) {
      p.note(
        `${pc.white("New version available:")} ${pc.dim(`v${APP_VERSION}`)} → ${pc.green(`v${newVer}`)}\n` +
          `${pc.dim("Run:")} ${pc.cyan("npm i -g @coflyn/mori")} ${pc.dim("to update")}`,
        pc.yellow("Update Available"),
      );
    }

    let keepGoing = true;

    while (keepGoing) {
      const urlInput = await p.text({
        message: "Paste link:",
        placeholder: "https://... or type /help",
        validate: (val) => {
          if (!val || val.trim().length === 0)
            return "Please enter a URL or /command.";
          const clean = val.trim().toLowerCase();
          if (clean === "exit" || clean === "quit" || clean === "q")
            return undefined;
          if (clean.startsWith("/")) return undefined;
          if (!detectPlatform(val.trim())) {
            return "Platform not supported. Type /platform to view supported platforms.";
          }
          return undefined;
        },
      });

      if (p.isCancel(urlInput)) {
        p.cancel("Exited.");
        process.exit(0);
      }

      const rawInput = urlInput.trim();
      const lower = rawInput.toLowerCase();

      // Forgiving exit without leading slash
      if (lower === "exit" || lower === "quit" || lower === "q") {
        p.outro(pc.dim("Exited."));
        process.exit(0);
      }

      // Slash command interceptor
      if (rawInput.startsWith("/")) {
        const [cmd, ...args] = rawInput.slice(1).split(/\s+/);
        const command = cmd.toLowerCase();

        switch (command) {
          case "platform":
          case "platforms": {
            const platformList = [
              `${pc.bold("Video  :")} TikTok, Douyin, YouTube, Instagram, Facebook, Bilibili, Reddit, Threads, Twitter/X`,
              `${pc.bold("Audio  :")} Spotify, Apple Music, Bandcamp`,
              `${pc.bold("Photo  :")} Pinterest, Pixiv, RedNote (Xiaohongshu)`,
              `${pc.bold("Cloud  :")} TeraBox (1024tera, nephobox, etc.)`,
            ];
            p.note(platformList.join("\n"), pc.dim("Supported Platforms (16)"));
            break;
          }

          case "play": {
            const items = getHistory(15);
            let targetItem = null;
            let targetNum = 1;

            if (args[0]) {
              const parsed = parseInt(args[0], 10);
              if (!isNaN(parsed)) {
                targetNum = parsed;
                if (targetNum < 1 || targetNum > items.length) {
                  p.log.warn(
                    `Invalid history index #${targetNum}. Available: 1 to ${items.length}.`,
                  );
                  break;
                }
                targetItem = items[targetNum - 1];
              } else {
                const customPath = path.resolve(args.join(" "));
                if (fs.existsSync(customPath)) {
                  const ext = path.extname(customPath).toLowerCase();
                  if (ext !== ".mp4" && ext !== ".mp3" && ext !== ".m4a") {
                    p.log.warn(
                      `Cannot play ${ext ? ext.toUpperCase() : "this"} file. /play is only for MP4 and MP3 (use /open to view files).`,
                    );
                    break;
                  }
                  try {
                    await openFile(customPath);
                    p.log.step(`${pc.bold("Playing:")} ${pc.dim(customPath)}`);
                  } catch (err) {
                    p.log.error(`Failed to play media: ${err.message}`);
                  }
                  break;
                }
              }
            } else {
              if (items.length > 0) {
                const playIdx = items.findIndex((it) => {
                  const ext = path
                    .extname(it.path || it.filename || "")
                    .toLowerCase();
                  return ext === ".mp4" || ext === ".mp3" || ext === ".m4a";
                });
                if (playIdx !== -1) {
                  targetItem = items[playIdx];
                  targetNum = playIdx + 1;
                } else {
                  targetItem = items[0];
                }
              }
            }

            if (!targetItem) {
              p.log.warn("No downloaded media found in history to play.");
              break;
            }

            if (!targetItem.path || !fs.existsSync(targetItem.path)) {
              p.log.error(
                `File no longer exists: ${targetItem.path || targetItem.filename}`,
              );
              break;
            }

            const fileExt = path
              .extname(targetItem.path || targetItem.filename || "")
              .toLowerCase();
            if (
              fileExt !== ".mp4" &&
              fileExt !== ".mp3" &&
              fileExt !== ".m4a"
            ) {
              p.log.warn(
                `Item #${targetNum} is a ${fileExt ? fileExt.toUpperCase() : "non-audio/video"} file. /play is only for MP4 and MP3 (type /open to view files).`,
              );
              break;
            }

            try {
              await openFile(targetItem.path);
              p.log.step(
                `${pc.bold("Playing:")} ${pc.white(`[#${targetNum}]`)} ${pc.bold(targetItem.filename || targetItem.title)} ${pc.dim(`(${targetItem.path})`)}`,
              );
            } catch (err) {
              p.log.error(`Failed to launch media player: ${err.message}`);
            }
            break;
          }

          case "delete":
          case "del":
          case "rm": {
            const items = getHistory(20);
            if (items.length === 0) {
              p.log.warn("No download history to delete.");
              break;
            }

            let targetIndex = -1;

            if (args[0]) {
              const numArg = parseInt(args[0], 10);
              if (isNaN(numArg) || numArg < 1 || numArg > items.length) {
                p.log.warn(
                  `Invalid index. Available range: 1 to ${items.length}.`,
                );
                break;
              }
              targetIndex = numArg - 1;
            } else {
              const selectChoice = await p.select({
                message: "Select item to delete:",
                options: [
                  ...items.map((it, idx) => ({
                    value: idx,
                    label: `[#${idx + 1}] ${it.filename || it.title || "Media"}`,
                    hint: it.platform || "",
                  })),
                  { value: -1, label: pc.dim("Cancel") },
                ],
              });

              if (p.isCancel(selectChoice) || selectChoice === -1) {
                break;
              }
              targetIndex = selectChoice;
            }

            const itemToDelete = items[targetIndex];
            const confirm = await p.confirm({
              message: `Delete "${itemToDelete.filename || itemToDelete.title}" from disk and history?`,
              initialValue: false,
            });

            if (p.isCancel(confirm) || !confirm) {
              p.log.step(pc.dim("Deletion cancelled."));
              break;
            }

            const res = deleteHistoryItem(targetIndex, true);
            if (res.success) {
              const fileNote = res.fileDeleted
                ? pc.dim("(deleted from disk & removed from history)")
                : pc.dim("(removed from history; file was not on disk)");
              p.log.step(
                `${pc.bold("✔ Deleted:")} ${pc.white(itemToDelete.filename || itemToDelete.title)} ${fileNote}`,
              );
            } else {
              p.log.error(`Failed to delete item: ${res.error}`);
            }
            break;
          }

          case "ping": {
            const host = args[0] || "1.1.1.1";
            const s = p.spinner();
            s.start(pc.dim(`Pinging ${host}...`));
            const res = await pingNetwork(host);

            if (!res.ok || res.avg < 0) {
              s.stop(
                pc.bold(`✕ Ping to ${host} failed`) +
                  pc.dim(` (${res.loss} loss)`),
              );
              break;
            }

            s.stop(
              `${pc.bold("Pong!")} ${pc.white(`${res.avg}ms`)} ` +
                pc.dim(
                  `(min ${res.min}ms • max ${res.max}ms • ${res.loss} loss • ${res.host})`,
                ),
            );
            break;
          }

          case "pdf": {
            let link = args.find((a) => a.startsWith("http"));
            if (!link) {
              const promptRes = await p.text({
                message: "Paste link to download as PDF album:",
                placeholder: "https://...",
                validate: (val) => {
                  if (!val || !val.trim()) return "Please enter a URL.";
                  if (!detectPlatform(val.trim()))
                    return "Platform not supported.";
                  return undefined;
                },
              });
              if (p.isCancel(promptRes)) break;
              link = promptRes.trim();
            }

            lastUrl = link;
            await handleScrapeAndDownload(link, {
              ...values,
              pdf: true,
              output: currentOutputDir,
            });
            break;
          }

          case "batch": {
            const batchInput = await p.text({
              message: "Paste multiple links (separated by space or newline):",
              placeholder: "https://... https://...",
              validate: (val) => {
                if (!val || val.trim().length === 0)
                  return "Please paste at least one link.";
                const urls = extractUrls(val);
                if (urls.length === 0) return "No valid URLs found.";
                return undefined;
              },
            });

            if (p.isCancel(batchInput)) break;

            const urls = extractUrls(batchInput);
            const supported = urls.filter((u) => Boolean(detectPlatform(u)));
            if (supported.length === 0) {
              p.log.error(
                "None of the provided links match supported platforms.",
              );
              break;
            }

            p.log.message(
              `${pc.bold("● Batch Queue:")} ${pc.white(supported.length)} link(s) queued` +
                (urls.length > supported.length
                  ? pc.dim(
                      ` (${urls.length - supported.length} unsupported skipped)`,
                    )
                  : ""),
            );

            for (let i = 0; i < supported.length; i++) {
              const u = supported[i];
              const plat = detectPlatform(u);
              p.log.step(
                `${pc.dim(`[${i + 1}/${supported.length}]`)} ${pc.inverse(` ${plat?.toUpperCase()} `)} ${pc.dim(u)}`,
              );
              await handleScrapeAndDownload(u, {
                ...values,
                yes: true,
                output: currentOutputDir,
              });
            }
            p.log.message(
              pc.bold(`✔ Batch download finished (${supported.length} items).`),
            );
            break;
          }

          case "open": {
            try {
              if (!fs.existsSync(currentOutputDir)) {
                fs.mkdirSync(currentOutputDir, { recursive: true });
              }
              await openDirectory(currentOutputDir);
              p.log.step(
                `${pc.bold("Opened folder:")} ${pc.dim(currentOutputDir)}`,
              );
            } catch (err) {
              p.log.error(`Failed to open directory: ${err.message}`);
            }
            break;
          }

          case "server": {
            const currentPref = getSavedConfig().defaultServer || "auto";
            const choice = await p.select({
              message: "Select default scraper server:",
              options: [
                {
                  value: "auto",
                  label: "Auto",
                  hint: "Best server per platform (default)",
                },
                {
                  value: "1",
                  label: "Server 1",
                  hint: "Primary (TikWM, SnapInsta, Cobalt, etc.)",
                },
                {
                  value: "2",
                  label: "Server 2",
                  hint: "Backup (LoveTik, FastDL, Viddly, etc.)",
                },
              ],
              initialValue: currentPref,
            });

            if (p.isCancel(choice)) break;

            saveConfig({ defaultServer: choice });
            p.log.message(
              `${pc.bold("● Default server set:")} ${pc.white(choice)}`,
            );
            break;
          }

          case "clip":
          case "paste": {
            const s = p.spinner();
            s.start(pc.dim("Reading clipboard..."));
            const clipText = await readClipboard();
            if (!clipText) {
              s.stop(pc.dim("Clipboard is empty."));
              break;
            }

            const urls = extractUrls(clipText);
            const valid = urls.find((u) => Boolean(detectPlatform(u)));
            if (!valid) {
              s.stop(pc.bold("✕ No supported media URL found in clipboard."));
              break;
            }

            const plat = detectPlatform(valid);
            s.stop(
              `${pc.bold("Link from clipboard:")} ${pc.inverse(` ${plat?.toUpperCase()} `)} ${pc.dim(valid)}`,
            );

            const isAudio =
              args.includes("-a") ||
              args.includes("--audio") ||
              args.includes("audio") ||
              args.includes("mp3");

            lastUrl = valid;
            await handleScrapeAndDownload(valid, {
              ...values,
              audio: isAudio || values.audio,
              output: currentOutputDir,
            });
            break;
          }

          case "audio":
          case "mp3": {
            let link = args.find((a) => a.startsWith("http"));
            if (!link) {
              const promptRes = await p.text({
                message: "Paste link for Audio-Only (MP3):",
                placeholder: "https://...",
                validate: (val) => {
                  if (!val || !val.trim()) return "Please enter a URL.";
                  if (!detectPlatform(val.trim()))
                    return "Platform not supported.";
                  return undefined;
                },
              });
              if (p.isCancel(promptRes)) break;
              link = promptRes.trim();
            }

            await handleScrapeAndDownload(link, {
              ...values,
              audio: true,
              output: currentOutputDir,
            });
            break;
          }

          case "history": {
            if (
              args[0] === "clear" ||
              args[0] === "clean" ||
              args[0] === "reset"
            ) {
              clearHistory();
              p.log.message(pc.dim("Download history cleared."));
              break;
            }

            const items = getHistory(15);
            if (items.length === 0) {
              p.log.message(pc.dim("No download history yet."));
              break;
            }

            // Check if user specified an iteration number, e.g. /history 1
            const numArg = parseInt(args[0], 10);
            if (!isNaN(numArg)) {
              if (numArg < 1 || numArg > items.length) {
                p.log.warn(
                  `Invalid history index #${numArg}. Available: 1 to ${items.length}.`,
                );
                break;
              }
              const selected = items[numArg - 1];
              if (!selected.url) {
                p.log.warn(
                  `Item #${numArg} has no recorded source URL (downloaded prior to URL tracking).`,
                );
                break;
              }
              p.log.message(
                `${pc.bold("● Re-downloading from history:")} ${pc.inverse(` ${selected.platform?.toUpperCase()} `)} ${pc.dim(selected.url)}`,
              );
              lastUrl = selected.url;
              await handleScrapeAndDownload(selected.url, {
                ...values,
                output: currentOutputDir,
              });
              break;
            }

            const historyLines = items.map((it, idx) => {
              const num = pc.bold(`[${idx + 1}]`);
              const badge = pc.inverse(` ${it.platform.toUpperCase()} `);
              const name = pc.bold(it.filename || it.title || "Media");
              const rel = it.timestamp
                ? pc.dim(`(${formatRelativeTime(it.timestamp)})`)
                : "";
              return `${num} ${badge} ${name} ${rel}`;
            });

            p.note(
              historyLines.join("\n"),
              pc.dim(
                `Recent Downloads (${items.length}) • /history <num> to redownload • /history clear to reset`,
              ),
            );
            break;
          }

          case "config": {
            const cfg = getSavedConfig();
            const cfgLines = [
              `${pc.bold("Download Dir  :")} ${pc.white(currentOutputDir)}`,
              `${pc.bold("Default Server:")} ${pc.white(cfg.defaultServer || "auto")}`,
              `${pc.bold("CLI Version   :")} ${pc.white(`v${APP_VERSION}`)}`,
              `${pc.bold("Core Version  :")} ${pc.white(`v${getActiveScraperVersion()}`)}`,
              `${pc.bold("Config Path   :")} ${pc.dim(CONFIG_PATH)}`,
            ];
            p.note(cfgLines.join("\n"), pc.dim("Active Configuration"));
            break;
          }

          case "info":
          case "inspect": {
            let link = args.find((a) => a.startsWith("http"));
            if (!link) {
              const promptRes = await p.text({
                message: "Paste link to inspect:",
                placeholder: "https://...",
                validate: (val) => {
                  if (!val || !val.trim()) return "Please enter a URL.";
                  if (!detectPlatform(val.trim()))
                    return "Platform not supported.";
                  return undefined;
                },
              });
              if (p.isCancel(promptRes)) break;
              link = promptRes.trim();
            }

            lastUrl = link;
            await handleScrapeAndDownload(link, {
              ...values,
              info: true,
              output: currentOutputDir,
            });
            break;
          }

          case "retry":
          case "again": {
            if (!lastUrl) {
              p.log.warn("No recent URL to retry.");
              break;
            }
            p.log.message(`${pc.bold("● Retrying link:")} ${pc.dim(lastUrl)}`);
            await handleScrapeAndDownload(lastUrl, {
              ...values,
              output: currentOutputDir,
            });
            break;
          }

          case "stats": {
            const stats = getStats();
            if (stats.totalDownloads === 0) {
              p.log.message(
                pc.dim("No statistics yet. Download some media first!"),
              );
              break;
            }

            const breakdown = Object.entries(stats.platformCounts)
              .map(
                ([plat, count]) =>
                  `  ${pc.bold(plat.toUpperCase().padEnd(12, " "))} : ${pc.white(count)} download(s)`,
              )
              .join("\n");

            const statLines = [
              `${pc.bold("Total Downloads :")} ${pc.white(stats.totalDownloads)} file(s)`,
              `${pc.bold("Total Storage   :")} ${pc.white(formatBytes(stats.totalBytes))}`,
              `${pc.bold("Top Platform    :")} ${pc.white(stats.topPlatform.toUpperCase())}`,
              "",
              pc.bold("Platform Breakdown:"),
              breakdown,
            ];
            p.note(statLines.join("\n"), pc.dim("视频爬取 Download Statistics"));
            break;
          }

          case "reset": {
            const confirm = await p.confirm({
              message:
                "Reset 视频爬取 config, cached scrapers, and history to factory defaults?",
              initialValue: false,
            });
            if (p.isCancel(confirm) || !confirm) {
              p.log.message(pc.dim("Reset cancelled."));
              break;
            }

            resetMori();
            currentOutputDir = DEFAULT_DOWNLOAD_DIR;
            p.log.message(
              pc.bold(
                "✔ Mori reset to default state (config, OTA cache, history cleared).",
              ),
            );
            break;
          }

          case "update":
          case "u": {
            const s = p.spinner();
            s.start(pc.dim("Checking for updates..."));
            try {
              const cliVer = await checkCliUpdate();
              const ota = await checkForOtaUpdate(true);

              s.stop(pc.bold("Update Check:"));

              if (cliVer) {
                p.note(
                  `${pc.white("New CLI release:")} ${pc.dim(`v${APP_VERSION}`)} → ${pc.green(`v${cliVer}`)}\n` +
                    `${pc.dim("Run:")} ${pc.cyan("npm i -g @coflyn/mori")}`,
                  pc.yellow("CLI Update Available"),
                );
              } else {
                p.log.step(
                  pc.dim(`CLI package is up to date (v${APP_VERSION}).`),
                );
              }

              if (ota.updated) {
                p.log.step(
                  pc.bold(`✔ Scrapers updated to v${ota.newVersion}`) +
                    (ota.changelog ? pc.dim(` — ${ota.changelog}`) : ""),
                );
              } else {
                p.log.step(
                  pc.dim(
                    `Scraper engine is up to date (v${ota.currentVersion}).`,
                  ),
                );
              }
            } catch (err) {
              s.stop(pc.bold(`✕ Update check failed: ${err.message}`));
            }
            break;
          }

          case "dir": {
            const targetDir = args.join(" ").trim();
            if (targetDir) {
              currentOutputDir = path.resolve(targetDir);
              if (!fs.existsSync(currentOutputDir))
                fs.mkdirSync(currentOutputDir, { recursive: true });
              saveConfig({ outputDir: currentOutputDir });
              p.log.message(
                `${pc.bold("● Saved output dir (persistent):")} ${pc.dim(currentOutputDir)}`,
              );
            } else {
              const newDir = await p.text({
                message: "Download directory (saved permanently):",
                initialValue: currentOutputDir,
              });
              if (!p.isCancel(newDir) && newDir.trim()) {
                currentOutputDir = path.resolve(newDir.trim());
                if (!fs.existsSync(currentOutputDir))
                  fs.mkdirSync(currentOutputDir, { recursive: true });
                saveConfig({ outputDir: currentOutputDir });
                p.log.message(
                  `${pc.bold("● Saved output dir (persistent):")} ${pc.dim(currentOutputDir)}`,
                );
              }
            }
            break;
          }

          case "clear":
          case "cls": {
            console.clear();
            printBanner(getActiveScraperVersion());
            break;
          }

          case "help":
          case "?": {
            const cmds = [
              `${pc.bold("/clip")}          Download link currently in clipboard`,
              `${pc.bold("/audio [url]")}   Download audio stream only (MP3/M4A)`,
              `${pc.bold("/pdf [url]")}     Download photo album compiled directly into 1 PDF`,
              `${pc.bold("/play [num]")}    Play downloaded media in default system player`,
              `${pc.bold("/ping [host]")}   Check user network latency (default: 1.1.1.1)`,
              `${pc.bold("/info [url]")}    Inspect media details without downloading`,
              `${pc.bold("/retry")}         Re-download the last link processed`,
              `${pc.bold("/batch")}         Bulk download multiple links at once`,
              `${pc.bold("/platform")}      List all 16 supported media platforms`,
              `${pc.bold("/dir")}           View or set download directory (persistent)`,
              `${pc.bold("/open")}          Open download folder in file manager`,
              `${pc.bold("/server")}        Set default scraper server (auto/1/2)`,
              `${pc.bold("/history [num]")}  View or redownload history item (/history 1, /history clear)`,
              `${pc.bold("/delete [num]")}   Delete downloaded file from disk and history`,
              `${pc.bold("/stats")}         View total downloads & storage statistics`,
              `${pc.bold("/config")}        Show active Mori configuration`,
              `${pc.bold("/update")}        Check and apply remote OTA scraper patch`,
              `${pc.bold("/reset")}         Factory reset Mori config, cache, & history`,
              `${pc.bold("/clear")}         Clear screen and reprint header`,
              `${pc.bold("/exit, /q")}      Exit Mori CLI`,
            ];
            p.note(cmds.join("\n"), pc.dim("Available Commands"));
            break;
          }

          case "exit":
          case "quit":
          case "q": {
            p.outro(pc.dim("Exited."));
            process.exit(0);
          }

          default:
            p.log.warn(
              `Unknown command: /${command}. Type /help for available commands.`,
            );
            break;
        }

        // Return to prompt without asking "Continue?"
        continue;
      }

      lastUrl = rawInput;
      await handleScrapeAndDownload(rawInput, {
        ...values,
        output: currentOutputDir,
      });

      const next = await p.confirm({
        message: "Continue?",
        initialValue: true,
      });

      if (p.isCancel(next) || !next) {
        keepGoing = false;
      }
    }

    p.outro(pc.dim("Complete."));
  }
}

main().catch((err) => {
  p.log.error(`Error: ${err.message}`);
  process.exit(1);
});
