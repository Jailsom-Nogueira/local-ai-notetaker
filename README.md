# Notetaker — Local AI Meeting Notes

Notetaker is a local-first meeting and voice-note app for macOS, Linux, and other
Node-supported desktops. It records microphone and optional system audio in the
browser, transcribes locally with `whisper.cpp`, and can generate a structured AI
review from the transcript with OpenAI.

Audio stays on your machine. The optional AI review sends transcript text only.

## Features

- Microphone recording from the browser.
- Optional system/tab audio capture through the browser screen-share dialog.
- Local transcription with `whisper-cli` and a local Whisper model.
- Ambient room-recording mode with browser-side gain and server-side loudness normalization.
- Language auto-detection, plus English, Portuguese, and Spanish force modes.
- Structured AI review: summary, key points, action items, decisions, open questions, topics, and sentiment.
- Share a transcript, an AI review, or both through local email and WhatsApp composer links.
- Local recording history stored as JSON plus the original audio file.

## Quick start

```bash
git clone <your-fork-or-repo-url> notetaker
cd notetaker
npm ci
cp .env.example .env.local
npm run setup:model
npm run dev
```

Open http://localhost:3000.

The AI review step needs `OPENAI_API_KEY` in `.env.local` or, on macOS, a Keychain
item named `OPENAI_API_KEY`. Transcription works without OpenAI as long as
`ffmpeg`, `whisper-cli`, and a Whisper model are available.

## Requirements

| Requirement | Notes |
| --- | --- |
| Node.js 20.9+ | Next.js runtime requirement. |
| npm | Use `npm ci` for reproducible installs. |
| ffmpeg | Required to normalize and convert browser audio before transcription. |
| whisper.cpp | Provides `whisper-cli` for local transcription. |
| Whisper model | `npm run setup:model` downloads `models/ggml-small.bin` by default. |
| OpenAI API key | Optional. Required only for AI review. |

macOS setup example:

```bash
brew install ffmpeg whisper-cpp
npm run setup:model
```

Linux setup varies by distribution. Install `ffmpeg`, install or build
`whisper.cpp`, make sure `whisper-cli` is on `PATH`, then run `npm run setup:model`.

## Configuration

Copy `.env.example` to `.env.local` and edit as needed:

```bash
cp .env.example .env.local
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | empty | Enables AI review. Do not commit this value. |
| `NOTETAKER_REVIEW_MODEL` | `gpt-4.1-mini` | OpenAI chat model used for reviews. |
| `WHISPER_BIN` | `whisper-cli` | Path or command name for whisper.cpp. |
| `WHISPER_MODEL_PATH` | `./models/ggml-small.bin` | Local model file used by whisper.cpp. |
| `RECORDINGS_DIR` | `./data/recordings` | Local storage for audio and metadata. |
| `MAX_AUDIO_BYTES` | `209715200` | Upload limit for a single recording, in bytes. |

On macOS you can store the OpenAI key in Keychain instead of `.env.local`:

```bash
security add-generic-password -a "$USER" -s OPENAI_API_KEY -w "sk-your-key"
```

## Usage

1. Select audio sources: microphone, system audio, or both.
2. Leave Ambient mode enabled for room conversations.
3. Choose language auto-detection or force a language.
4. Click Start recording.
5. Click Stop when done.
6. Review the local transcript and optional AI analysis.
7. Share the transcript, AI review, or both via email or WhatsApp when needed.

For system audio, the browser opens a screen-share picker. Choose a tab or window
and enable audio sharing in that browser dialog.

## Local data and privacy

The following paths are intentionally ignored by Git:

- `.env.local` and other `.env*` files.
- `data/recordings/` because it contains private audio and transcripts.
- `models/` because Whisper model files are large binary artifacts.
- `.next/`, `node_modules/`, and TypeScript build cache files.

Before publishing a fork, run:

```bash
npm run check:publication
```

This checks source and documentation for common private-path and secret patterns.
It does not scan ignored runtime data such as recordings or model binaries.

## Architecture

```text
Browser recorder
  ├─ MediaRecorder captures microphone audio
  ├─ getDisplayMedia optionally captures tab/system audio
  └─ WebAudio gain + limiter improves room recordings
        │
        ▼
Next.js route handlers
  ├─ /api/transcribe: saves audio, converts with ffmpeg, transcribes with whisper-cli
  ├─ /api/review: sends transcript text to OpenAI and stores structured JSON
  ├─ /api/recordings: lists local recordings
  └─ /api/recordings/[id]: deletes one local recording
        │
        ▼
Local filesystem
  ├─ data/recordings/*.webm
  └─ data/recordings/*.json
```

See `docs/ARCHITECTURE.md` for more detail.

## Development

```bash
npm run typecheck
npm run lint
npm run build
npm run check
```

`npm run check` runs publication checks, TypeScript, ESLint, and a production build.

## Contributing

See `CONTRIBUTING.md`.

## Security

See `SECURITY.md`.

## License

MIT. See `LICENSE`.
