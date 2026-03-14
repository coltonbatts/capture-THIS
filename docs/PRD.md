# Product Requirements Document: CaptureThis

**Version:** 0.1  
**Last Updated:** March 9, 2025  
**Status:** Draft

---

## 1. Overview

### 1.1 Product Summary

**CaptureThis** is a desktop-oriented YouTube and media downloader with a goth-minimal interface. It provides a premium, focused experience for downloading video content from YouTube and other yt-dlp–supported sites, with metadata inspection, quality selection, and live progress streaming.

### 1.2 Problem Statement

Users who want to save YouTube videos for offline viewing, archival, or editing face fragmented tools: browser extensions with limited quality control, CLI tools with steep learning curves, or bloated desktop apps with poor UX. There is a gap for a simple, beautiful, and powerful downloader that respects user control over quality and format.

### 1.3 Solution

CaptureThis combines the reliability of **yt-dlp** with a modern Next.js web UI. Users paste URLs, inspect metadata and quality options before downloading, and watch live progress over Server-Sent Events. The app runs locally and writes files directly to the user’s machine—no cloud intermediary.

---

## 2. Vision & Goals

### 2.1 Vision

A minimal, opinionated media downloader that feels like a professional tool—fast, predictable, and visually distinctive.

### 2.2 Goals

| Goal | Description |
|------|-------------|
| **Simplicity** | Paste URLs, review, download. No account, no signup, no ads. |
| **Transparency** | Show metadata, quality ladder, and live progress before and during download. |
| **Control** | Let users choose resolution, container format, and output location. |
| **Reliability** | Sequential queue, graceful cancellation, and persistence across restarts. |
| **Aesthetic** | A goth-minimal UI that stands apart from generic downloaders. |

### 2.3 Non-Goals (Current Phase)

- Cloud storage or sync
- Mobile app
- Browser extension
- Social or sharing features
- Monetization or paid tiers

---

## 3. Target Users

### 3.1 Primary Persona

**Power User / Archivist**  
- Downloads videos for offline viewing, archival, or editing  
- Cares about quality (resolution, codec) and format (MP4, MOV, etc.)  
- Comfortable with local tools and system dependencies (yt-dlp, ffmpeg)  
- Prefers keyboard and clipboard workflows  

### 3.2 Secondary Persona

**Casual Downloader**  
- Occasionally saves a video for later  
- Wants a simple paste-and-download flow  
- May not understand codecs but appreciates clear options  

### 3.3 User Needs

- Paste one or more URLs and get immediate feedback  
- See title, thumbnail, duration, and available qualities before downloading  
- Choose output folder and file name  
- Monitor download progress in real time  
- Cancel in-progress downloads  
- Reveal completed files in Finder/Explorer  

---

## 4. Current State

### 4.1 Implemented Features

| Feature | Status | Notes |
|---------|--------|-------|
| URL input (paste, multi-line) | ✅ | Extracts URLs from text blocks |
| Metadata inspection | ✅ | Title, thumbnail, duration, quality ladder |
| Quality selection | ✅ | Best available or max resolution (e.g., 1080p) |
| Output format | ✅ | MP4, MOV, MKV, WEBM |
| Codec strategy | ✅ | QuickTime compatible vs highest available |
| Output directory | ✅ | Configurable, default `~/Downloads/Capture This/` |
| Sequential download queue | ✅ | One job at a time |
| Live progress (SSE) | ✅ | Percent, speed, ETA streamed to UI |
| Cancel download | ✅ | SIGTERM → SIGKILL fallback |
| Reveal in Finder | ✅ | Opens file location on macOS |
| Job persistence | ✅ | Survives server restart; in-progress jobs re-queued |
| System checks | ✅ | Validates yt-dlp, ffmpeg, output directory |

### 4.2 Technical Stack

| Layer | Technology |
|-------|-------------|
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| Styling | CSS Modules, CSS variables |
| Animation | Framer Motion |
| Icons | Lucide React |
| Backend | Next.js API Routes (Node.js runtime) |
| Download engine | yt-dlp (subprocess) |
| Media processing | ffmpeg (via yt-dlp) |
| Persistence | JSON file in download directory |

### 4.3 System Requirements

- **Node.js** 22+
- **yt-dlp** in `PATH`
- **ffmpeg** in `PATH`
- Default output: `~/Downloads/Capture This/`

---

## 5. Feature Specification

### 5.1 Core User Flows

#### Flow 1: Single Video Download

1. User pastes a YouTube (or supported) URL into the Source Links textarea.
2. App debounces input (420ms) and extracts URLs.
3. For each URL, app calls `/api/metadata` to fetch title, thumbnail, duration, qualities.
4. User sees metadata cards with thumbnail, title, duration, max quality.
5. User optionally edits file name and resolution target per source.
6. User selects destination folder, file type (MP4/MOV/MKV/WEBM), and codec strategy.
7. User clicks **Download**.
8. Job is queued; progress streams via SSE.
9. On completion, user can click **Reveal File** to open in Finder.

#### Flow 2: Batch Download

1. User pastes multiple URLs (one per line or block).
2. App inspects all URLs in parallel.
3. User reviews all metadata cards; invalid URLs show errors.
4. User queues all valid sources with one click.
5. Jobs run sequentially; UI shows active job and progress.
6. User can cancel the active job; queued jobs remain.

#### Flow 3: Cancel & Recovery

1. User cancels an in-progress download → yt-dlp process is killed.
2. User restarts the app → queued jobs are reloaded from `.capturethis-history.json`.
3. In-progress jobs at shutdown are reset to `queued` and re-processed.

### 5.2 API Surface

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/system` | GET | Check yt-dlp, ffmpeg, output directory |
| `/api/metadata` | POST | Extract metadata for a URL |
| `/api/download` | GET | SSE stream for queue snapshots and progress |
| `/api/download` | POST | Add a download job to the queue |
| `/api/download` | DELETE | Cancel a job by `jobId` |
| `/api/download/reveal` | POST | Open file path in Finder (macOS) |

### 5.3 Data Models

**DownloadJob**

- `id`, `url`, `title`, `thumbnail`
- `status`: `queued` | `downloading` | `completed` | `failed` | `cancelled`
- `quality`, `mode`, `outputContainer`, `videoProfile`, `threads`
- `outputDirectory`, `outputName`
- `progress`: `percent`, `percentLabel`, `speed`, `eta`, `downloaded`, `total`
- `filePath`, `error`, `createdAt`, `updatedAt`

**MetadataResponse**

- `url`, `title`, `thumbnail`, `uploader`, `durationSeconds`, `durationLabel`
- `extractor`, `description`
- `qualities`: array of resolution strings (e.g. `["2160","1080","720"]`)
- `formats`: array of `MediaFormatSummary`

---

## 6. Roadmap

### 6.1 Phase 1: Foundation (Current)

- [x] Core download flow
- [x] Metadata inspection
- [x] Sequential queue with SSE
- [x] Job persistence
- [x] Cancel and reveal

### 6.2 Phase 2: Enhanced Control

- [ ] **Audio-only mode** – Download as MP3/FLAC (types already support `mode: "audio"`)
- [ ] **Video-only mode** – No audio track (types support `mode: "video-only"`)
- [ ] **Folder picker** – Native dialog instead of text input
- [ ] **Download history** – List of completed jobs with clear/archive
- [ ] **Retry failed jobs** – One-click retry from failed state

### 6.3 Phase 3: Experience

- [ ] **Playlist support** – Expand playlists into individual jobs
- [ ] **Drag-and-drop** – Drop URLs or files onto the input area
- [ ] **Keyboard shortcuts** – Paste (⌘V), Download (⌘Enter), etc.
- [ ] **Dark/light theme toggle** – Extend goth-minimal with a light variant
- [ ] **Cross-platform reveal** – Windows Explorer, Linux file manager

### 6.4 Phase 4: Distribution

- [ ] **Tauri desktop app** – Package as standalone executable (no Node required for end users)
- [ ] **Bundled yt-dlp/ffmpeg** – Optional embedded binaries for zero-setup install
- [ ] **Auto-update** – Check for yt-dlp and app updates

---

## 7. Non-Functional Requirements

### 7.1 Performance

- Metadata fetch: target &lt; 5s for typical YouTube video
- SSE latency: &lt; 500ms for progress updates
- UI: 60fps animations, no jank during queue updates

### 7.2 Reliability

- Graceful degradation if yt-dlp or ffmpeg missing
- Queue survives server restart
- Cancellation must terminate child process within 5s

### 7.3 Security & Privacy

- No telemetry or analytics
- All processing local; no data sent to third parties
- URLs and metadata stay on the user’s machine

### 7.4 Accessibility

- Semantic HTML and ARIA where appropriate
- Keyboard-navigable form and actions
- Sufficient color contrast for goth palette

---

## 8. Risks & Constraints

### 8.1 Risks

| Risk | Mitigation |
|------|------------|
| YouTube/API changes break yt-dlp | Rely on yt-dlp’s active maintenance; document update path |
| Large queues cause memory pressure | Cap queue size; consider pagination for history |
| User runs without yt-dlp/ffmpeg | Clear system check UI; link to install instructions |

### 8.2 Constraints

- **yt-dlp ToS** – Users must comply with YouTube and site terms of service
- **Local-only** – No server deployment for multi-user; single-user local tool
- **macOS-first** – Reveal in Finder is macOS-specific; Windows/Linux need separate implementation

---

## 9. Success Metrics

| Metric | Target |
|--------|--------|
| Time to first download | &lt; 30s from paste to queue |
| Download completion rate | &gt; 95% for valid URLs |
| Crash recovery | Queue restores correctly after restart |
| User satisfaction | Subjective: “feels fast and predictable” |

---

## 10. Appendix

### A. File Structure

```
Capturethis/
├── app/
│   ├── api/
│   │   ├── download/route.ts    # Queue, SSE, cancel, reveal
│   │   ├── metadata/route.ts    # Metadata extraction
│   │   └── system/route.ts      # System checks
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── downloader-shell.tsx     # Main UI
│   └── downloader-shell.module.css
├── lib/
│   ├── download-manager.ts     # Queue engine, yt-dlp spawn
│   ├── download-preset.ts      # Defaults
│   ├── store.ts                # Job persistence
│   ├── system.ts               # Paths, binary checks
│   ├── types.ts                # Shared types
│   ├── url.ts                  # URL parsing
│   └── yt-dlp.ts               # Metadata, arg builder
└── docs/
    └── PRD.md
```

### B. References

- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
