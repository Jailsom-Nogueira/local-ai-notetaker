import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  convertToWav16k,
  transcribeWithWhisper,
  saveRecording,
  RECORDINGS_DIR,
  ensureRecordingsDir,
  type RecordingMeta,
} from '@/lib/server';

export const runtime = 'nodejs';
export const maxDuration = 600;

const DEFAULT_MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const ALLOWED_LANGUAGES = new Set(['auto', 'en', 'pt', 'es']);
const ALLOWED_SOURCES = new Set(['mic', 'system']);
const ALLOWED_EXTENSIONS = new Set(['webm', 'ogg', 'wav', 'mp4', 'm4a']);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function configuredMaxAudioBytes(): number {
  const value = Number(process.env.MAX_AUDIO_BYTES || DEFAULT_MAX_AUDIO_BYTES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_AUDIO_BYTES;
}

function newId() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `rec-${ts}-${Math.random().toString(36).slice(2, 7)}`;
}

function safeExtension(file: File): string {
  const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : undefined;
  if (ext && ALLOWED_EXTENSIONS.has(ext)) return ext;
  if (file.type.includes('ogg')) return 'ogg';
  if (file.type.includes('wav')) return 'wav';
  if (file.type.includes('mp4')) return 'mp4';
  return 'webm';
}

export async function POST(req: NextRequest) {
  let inputPath: string | null = null;
  let wavPath: string | null = null;

  try {
    const form = await req.formData();
    const file = form.get('audio') as File | null;
    const sources = String(form.get('sources') || 'mic')
      .split(',')
      .filter(source => ALLOWED_SOURCES.has(source));
    const durationSec = Number(form.get('durationSec') || 0);
    const title = String(form.get('title') || '').slice(0, 120);
    const language = String(form.get('language') || 'auto');

    if (!file) {
      return NextResponse.json({ error: 'No audio file uploaded.' }, { status: 400 });
    }
    if (file.size < 1000) {
      return NextResponse.json({ error: 'Audio file too small. The recording appears to be empty.' }, { status: 400 });
    }
    if (file.size > configuredMaxAudioBytes()) {
      return NextResponse.json({ error: 'Audio file exceeds the configured upload limit.' }, { status: 413 });
    }
    if (!ALLOWED_LANGUAGES.has(language)) {
      return NextResponse.json({ error: 'Unsupported transcription language.' }, { status: 400 });
    }

    await ensureRecordingsDir();
    const id = newId();
    inputPath = path.join(RECORDINGS_DIR, `${id}.${safeExtension(file)}`);
    await fs.writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

    wavPath = await convertToWav16k(inputPath);

    const modelPath = process.env.WHISPER_MODEL_PATH || path.join(process.cwd(), 'models', 'ggml-small.bin');
    const whisperBin = process.env.WHISPER_BIN || 'whisper-cli';

    const { text, segments, language: detectedLang } =
      await transcribeWithWhisper(wavPath, modelPath, whisperBin, language);

    try { await fs.unlink(wavPath); } catch {}
    try { await fs.unlink(wavPath.replace(/\.wav$/, '.json')); } catch {}

    const firstSentence = text.split(/[.?!]/)[0] || 'Untitled note';
    const niceTitle = title || firstSentence.slice(0, 80).trim();

    const meta: RecordingMeta = {
      id,
      createdAt: new Date().toISOString(),
      durationSec: Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0,
      title: niceTitle || 'Untitled note',
      sources: sources.length ? sources : ['mic'],
      transcript: text,
      segments,
      language: detectedLang,
      review: null,
    };
    await saveRecording(meta);

    return NextResponse.json({ ok: true, recording: meta });
  } catch (error) {
    console.error('[transcribe] error', error);
    const detail = process.env.NODE_ENV === 'development' ? ` ${getErrorMessage(error)}` : '';
    return NextResponse.json(
      { error: `Transcription failed.${detail}` },
      { status: 500 }
    );
  }
}
