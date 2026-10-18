<p align="center">
  <h1 align="center">@coflyn/mori</h1>
  <p align="center"><strong>Universal Media Downloader CLI</strong></p>
  <p align="center"><em>Save anything, from anywhere. No watermarks. No tracking.</em></p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@coflyn/mori"><img src="https://img.shields.io/npm/v/@coflyn/mori?style=flat-square&color=blue" alt="NPM Version"></a>
  <a href="https://www.npmjs.com/package/@coflyn/mori"><img src="https://img.shields.io/npm/dm/@coflyn/mori?style=flat-square&color=green" alt="NPM Downloads"></a>
  <a href="https://github.com/coflyn/Mori"><img src="https://img.shields.io/badge/License-GPL--3.0-blue?style=flat-square" alt="License"></a>
  <a href="https://github.com/coflyn/Mori"><img src="https://img.shields.io/badge/GitHub-coflyn%2FMori-black?style=flat-square&logo=github" alt="GitHub"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/coflyn/Mori/main/assets/cli.webp" width="90%" alt="Mori CLI Preview">
</p>

---

Command-line interface for **[Mori](https://github.com/coflyn/Mori)**. Download watermark-free videos, high-resolution photos, music, playlists, and compile albums into PDF across 16 platforms directly from your terminal.

## ⚡ Quick Start

Run instantly without global installation via `npx`:

```bash
# Interactive REPL mode
npx @coflyn/mori

# Download any link directly
npx @coflyn/mori https://www.tiktok.com/@user/video/123456789

# Download audio only (MP3)
npx @coflyn/mori https://youtu.be/dQw4w9WgXcQ -a

# Compile photo carousel into a single PDF album
npx @coflyn/mori https://www.instagram.com/p/C_abc123/ -p
```

Or install globally:

```bash
npm install -g @coflyn/mori
mori
```

---

## 🌐 Supported Platforms (16)

| Platform                  | Capabilities                                                |
| :------------------------ | :---------------------------------------------------------- |
| **TikTok**                | No-watermark video (HD/1080p), MP3 audio, slide photos      |
| **Instagram**             | Reels, stories, posts, photos, carousels                    |
| **YouTube**               | MP4 video, MP3 audio, full playlists & albums               |
| **Twitter / X**           | All resolutions, GIFs, MP4 video                            |
| **Spotify**               | Single tracks, full albums & playlists to MP3 (128–320kbps) |
| **Apple Music**           | Tracks, albums, and playlists to high-quality MP3           |
| **Pinterest**             | Original full-resolution images, video pins                 |
| **Facebook**              | Public reels & HD videos                                    |
| **Threads**               | Videos and photo carousels                                  |
| **Reddit**                | Videos with synced audio, multi-image galleries             |
| **Bilibili**              | High-definition DASH video & audio streams                  |
| **Douyin**                | Watermark-free videos & photo carousels                     |
| **RedNote (Xiaohongshu)** | High-res photos and videos                                  |
| **Pixiv**                 | Artwork galleries and animated Ugoira                       |
| **Bandcamp**              | Individual songs and full discographies                     |
| **TeraBox**               | Direct stream extraction                                    |

---

## 🛠️ CLI Options

```text
USAGE:
  mori [URL] [OPTIONS]
  npx @coflyn/mori [URL] [OPTIONS]

OPTIONS:
  -o, --output <dir>   Custom download destination (default: ~/Downloads/Mori)
  -s, --server <1|2>   Select scraper server engine (1 = Default, 2 = Mirror)
  -a, --audio          Extract and download audio stream only (MP3/M4A)
  -p, --pdf            Compile multi-photo posts directly into a single PDF album
  -c, --clip           Auto-detect and download URL from system clipboard
  -y, --yes            Auto-confirm and download best available stream
  -i, --info           Inspect and display media metadata only (no download)
  -u, --update         Check and apply latest OTA scraper patches
  -h, --help           Show help and usage documentation
  -v, --version        Display CLI version
```

---

## 💬 Interactive Shell & Slash Commands

Launch `mori` without arguments to enter the interactive CLI shell:

```bash
mori
```

Inside the interactive prompt, type `/` to access built-in tools:

| Command          | Aliases       | Description                                                                        |
| :--------------- | :------------ | :--------------------------------------------------------------------------------- |
| `/clip`          | `/paste`      | Auto-detect and download media link currently on system clipboard                  |
| `/audio [url]`   | `/mp3`        | Extract and download audio stream only (MP3/M4A)                                   |
| `/pdf [url]`     | —             | Compile photo carousel or gallery directly into a single PDF album                 |
| `/batch`         | —             | Bulk-download multiple links at once (space or newline separated)                  |
| `/play [num]`    | —             | Open and play downloaded MP4/MP3 media in your default system player               |
| `/history [num]` | —             | View download history, re-download (`/history <num>`), or purge (`/history clear`) |
| `/delete [num]`  | `/del`, `/rm` | Remove item from history with prompt to delete file from disk                      |
| `/open`          | —             | Open download folder in your OS file manager (Finder / File Explorer)              |
| `/dir [path]`    | —             | View or set default download destination folder permanently                        |
| `/server`        | —             | Select default scraper engine (`auto`, `1`, `2`)                                   |
| `/info [url]`    | `/inspect`    | Inspect media details and available streams without downloading                    |
| `/retry`         | `/again`      | Re-download the last processed link                                                |
| `/ping [host]`   | —             | Test network latency and packet loss (default: 1.1.1.1)                            |
| `/stats`         | —             | View total files downloaded, disk space used, and platform breakdown               |
| `/platforms`     | `/platform`   | List all 16 supported media platforms and categories                               |
| `/config`        | —             | Display active configuration, storage paths, and versions                          |
| `/update`        | `/u`          | Check for both CLI package updates (npm) and OTA scraper patches                   |
| `/reset`         | —             | Factory reset Mori configuration, cached scrapers, and history                     |
| `/clear`         | `/cls`        | Clear terminal screen and reprint header                                           |
| `/help`          | `/?`          | Display quick command reference guide                                              |
| `/exit`          | `/quit`, `/q` | Exit interactive CLI mode                                                          |

---

## 🚀 Key Features

- **16 Platforms Supported**: Save media from TikTok, Instagram, YouTube, Twitter/X, Spotify, Apple Music, Pinterest, Facebook, Threads, Reddit, Bilibili, Douyin, RedNote, Pixiv, Bandcamp, and TeraBox.
- **Automatic Version Checker**: Fast, non-blocking check on launch alerts you with a notification box whenever a newer CLI release is available on npm.
- **Dual Update System**: Run `/update` to check for both newer CLI package versions on npm and live OTA scraper engine patches from GitHub.
- **Multi-Processing Parallel Downloads**: High-speed concurrent downloads for photo galleries and batch links with optimized worker pools.
- **Single-Row In-Place Updates**: Dynamic in-place terminal spinner without spamming new lines for every photo.
- **Instant Photo-to-PDF**: Combine multi-image posts and photo carousels into a single, clean PDF file (`-p` / `--pdf`).
- **Integrated Terminal Player**: Launch and listen/watch downloaded videos and audio directly via `/play <num>`.
- **History & Disk Sync Deletion**: Keep track of downloaded files, re-download past items, or delete files from disk and history via `/delete <num>`.
- **Clipboard Detection**: One-command downloads from your clipboard (`-c` / `--clip` or `/clip`).
- **Dual-Server Redundancy**: Seamlessly switch between primary and mirror servers for platforms like TikTok, Instagram, YouTube, X, and Spotify.
- **Over-The-Air (OTA) Hot-Patching**: Scrapers update dynamically via GitHub when upstream platform APIs change, without waiting for an NPM package release.
- **Built-in Network Diagnostics**: Check connection latency and packet loss to download servers using `/ping`.
- **100% Local & Private**: No analytics, no accounts, and no data telemetry. Configuration and history are stored locally in `~/.mori`.

---

## 📄 License

Licensed under the [GNU General Public License v3.0](https://github.com/coflyn/Mori/blob/main/LICENSE).
Part of the **[Mori](https://github.com/coflyn/Mori)** project.
