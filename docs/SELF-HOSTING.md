# Self-hosting guide

This guide assumes you are running Notetaker for yourself or a small trusted group
on a machine you control. The default storage is local filesystem storage.

## 1. Install system dependencies

macOS:

```bash
brew install node ffmpeg whisper-cpp
```

Linux:

```bash
# Example package names vary by distribution.
sudo apt-get update
sudo apt-get install -y nodejs npm ffmpeg
```

Then install or build `whisper.cpp` and make sure `whisper-cli` is on `PATH`.

## 2. Clone and install

```bash
git clone <your-fork-or-repo-url> notetaker
cd notetaker
npm ci
```

## 3. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and set at least:

```bash
WHISPER_BIN=whisper-cli
WHISPER_MODEL_PATH=./models/ggml-small.bin
RECORDINGS_DIR=./data/recordings
```

Set `OPENAI_API_KEY` only if you want AI review.

## 4. Download a Whisper model

```bash
npm run setup:model
```

The default script downloads `ggml-small.bin` into `models/`. To use another model:

```bash
WHISPER_MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin" \
WHISPER_MODEL_PATH="./models/ggml-medium.bin" \
npm run setup:model
```

## 5. Run locally

```bash
npm run dev
```

Open http://localhost:3000.

## 6. Production build

```bash
npm run check
npm run build
npm run start
```

For a public deployment, place a reverse proxy in front of the Next.js server and
set appropriate TLS, request-size, and rate-limit controls. This project is local-first
and does not include user authentication.

## 7. Runtime data

These paths are local runtime data and should not be committed:

- `.env.local`
- `data/recordings/`
- `models/*.bin`
- `.next/`

Back up `data/recordings/` if you need to preserve local notes.

## 8. Health check

When the app is running, visit:

```text
http://localhost:3000/api/health
```

The response reports whether `ffmpeg`, `whisper-cli`, the model file, and OpenAI
configuration are available. It does not expose API keys.

## 9. Going back to zero

To remove local runtime data:

```bash
rm -rf .next data/recordings models/*.bin
```

Keep `.env.local` only if you want to preserve your local configuration.
