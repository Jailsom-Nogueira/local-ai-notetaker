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
| `POST /api/recordings/start` | Begin a streamed session: create an empty local audio file and a `recording` status. |
| `PUT /api/recordings/[id]/chunk` | Append one ordered audio chunk to the session file, enforcing the cumulative size cap. |
| `POST /api/recordings/[id]/finalize` | Normalize, transcribe (chunked), and persist the captured session; returns immediately while processing continues, updating status. |
| `POST /api/transcribe` | Single-shot path: accept one audio file, save it locally, then run the same `processRecording` pipeline. |
| `POST /api/review` | Load a local transcript and ask OpenAI for a structured JSON review. Long transcripts use map-reduce summarization. |
| `GET /api/recordings` | List locally saved recording metadata plus pending (unfinished) sessions. |
| `GET /api/recordings/[id]` | Return a finalized recording, or processing status for client polling. |
| `DELETE /api/recordings/[id]` | Delete local metadata, audio, and sidecar files for one recording id. |
| `GET /api/health` | Check local dependencies without exposing secrets. |

### Long-recording lifecycle

For multi-hour recordings the browser streams audio to disk as it records, so a
tab crash, sleep, or accidental close does not lose the session:

1. `POST /api/recordings/start` creates `<id>.webm` and `<id>.status.json`.
2. `MediaRecorder` emits ordered chunks; each is appended via `PUT .../chunk`.
3. `POST .../finalize` runs `ffmpeg` normalization, splits the WAV into
   fixed-length segments (`NOTETAKER_SEGMENT_SECONDS`), transcribes each with
   `whisper-cli`, stitches the segments with offset timestamps, and saves
   `<id>.json`. Progress is written to `<id>.status.json` and polled by the
   client via `GET /api/recordings/[id]`.
4. Sessions captured but never finalized appear as pending and can be finished
   or discarded from the UI.

Status and segment sidecar files are excluded from the recordings list and are
removed with the recording on delete.

### Local filesystem

Runtime files are stored under `RECORDINGS_DIR`, which defaults to
`./data/recordings`. This directory is ignored by Git because it contains private
audio, transcripts, and AI reviews.

Whisper models live under `./models` by default. Model binaries are ignored by
Git because they are large generated artifacts.

## Data flow

```text
Browser audio chunks (streamed)
  -> POST /api/recordings/start            (create <id>.webm + <id>.status.json)
  -> PUT  /api/recordings/<id>/chunk ...   (append ordered chunks)
  -> POST /api/recordings/<id>/finalize
       -> ffmpeg normalized WAV
       -> split into NOTETAKER_SEGMENT_SECONDS pieces
       -> whisper-cli per segment, merged with offset timestamps
       -> data/recordings/<id>.json
  -> POST /api/review
       -> OpenAI text-only request (map-reduce for long transcripts)
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
