# Architecture

Notetaker is intentionally small. It is a local-first Next.js app with browser
capture, local transcription, and an optional server-side AI review.

## Components

### Browser client

`src/app/page.tsx` owns the recording UI and browser audio pipeline:

- `getUserMedia` captures microphone audio.
- `getDisplayMedia` optionally captures tab or system audio.
- WebAudio applies gain and a soft limiter for room recording.
- `MediaRecorder` encodes audio chunks as WebM/Opus when supported.

The client never receives or stores API keys.

Transcript and review sharing is also client-side. The browser formats the
selected local text and opens an email or WhatsApp composer link only after the
user clicks a share destination; there is no Notetaker backend delivery service.

### Route handlers

Route handlers run in the Node.js runtime.

| Route | Responsibility |
| --- | --- |
| `POST /api/transcribe` | Accept one audio file, save it locally, normalize it with `ffmpeg`, transcribe it with `whisper-cli`, and save metadata. |
| `POST /api/review` | Load a local transcript and ask OpenAI for a structured JSON review. |
| `GET /api/recordings` | List locally saved recording metadata. |
| `DELETE /api/recordings/[id]` | Delete local metadata and audio files for one recording id. |
| `GET /api/health` | Check local dependencies without exposing secrets. |

### Local filesystem

Runtime files are stored under `RECORDINGS_DIR`, which defaults to
`./data/recordings`. This directory is ignored by Git because it contains private
audio, transcripts, and AI reviews.

Whisper models live under `./models` by default. Model binaries are ignored by
Git because they are large generated artifacts.

## Data flow

```text
Browser audio Blob
  -> POST /api/transcribe
  -> data/recordings/<id>.webm
  -> ffmpeg normalized WAV
  -> whisper-cli JSON output
  -> data/recordings/<id>.json
  -> POST /api/review
  -> OpenAI text-only request
  -> data/recordings/<id>.json with review
```

## Security boundaries

- Audio files do not leave the host.
- Only transcript text is sent to OpenAI, and only when AI review is requested.
- Recording ids must match `rec-YYYYMMDD-HHMMSS-xxxxx` before filesystem access.
- API keys are read on the server from environment variables or macOS Keychain.
- Client code does not import server-only modules.
- Share links are explicit user actions and do not add cloud sync, hosted
  storage, analytics, or background uploads.
- Production responses include baseline security headers from `next.config.mjs`. The CSP allows Next.js inline bootstrapping scripts while restricting external scripts to the app origin.

## Non-goals

- Multi-user authentication.
- Cloud sync.
- Browser-only transcription.
- Storing recordings in object storage.

Those are good future extensions, but this project is designed to remain useful as
a simple local desktop app.
