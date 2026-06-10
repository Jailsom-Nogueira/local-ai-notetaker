import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ALLOWED_LANGUAGES,
  ALLOWED_SOURCES,
  configuredMaxAudioBytes,
  newRecordingId,
  processRecording,
  RECORDINGS_DIR,
  ensureRecordingsDir,
} from '@/lib/server';

export const runtime = 'nodejs';
export const maxDuration = 1800;

const ALLOWED_EXTENSIONS = new Set(['webm', 'ogg', 'wav', 'mp4', 'm4a']);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    const id = newRecordingId();
    inputPath = path.join(RECORDINGS_DIR, `${id}.${safeExtension(file)}`);
    await fs.writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

    const meta = await processRecording(id, inputPath, {
      sources,
      language,
      durationSec,
      title,
    });

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
