# CaptureTHIS

CaptureTHIS is a Next.js App Router downloader shell with a goth-minimal interface, a sequential yt-dlp queue engine, metadata inspection, and live progress streamed over Server-Sent Events.

## Requirements

- Node.js 22+
- `yt-dlp` available in `PATH`
- `ffmpeg` available in `PATH`

Downloads are written to `~/Downloads/Capture This/`.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API surface

- `GET /api/system` checks `yt-dlp`, `ffmpeg`, and the output directory
- `POST /api/metadata` extracts title, thumbnail, formats, and quality ladder
- `GET /api/download` streams queue updates over SSE
- `POST /api/download` adds a new sequential download job
