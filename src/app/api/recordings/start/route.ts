import { NextRequest, NextResponse } from 'next/server';
import {
  ALLOWED_LANGUAGES,
  ALLOWED_SOURCES,
  newRecordingId,
  startRecordingSession,
} from '@/lib/server';

export const runtime = 'nodejs';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as
      | { sources?: unknown; language?: unknown; title?: unknown }
      | null;

    const sources = Array.isArray(body?.sources)
      ? body.sources.map(String).filter(source => ALLOWED_SOURCES.has(source))
      : [];
    const language = typeof body?.language === 'string' ? body.language : 'auto';
    const title = typeof body?.title === 'string' ? body.title.slice(0, 120) : '';

    if (!ALLOWED_LANGUAGES.has(language)) {
      return NextResponse.json({ error: 'Unsupported transcription language.' }, { status: 400 });
    }
    if (sources.length === 0) {
      return NextResponse.json({ error: 'Select at least one audio source.' }, { status: 400 });
    }

    const id = newRecordingId();
    await startRecordingSession(id, { sources, language, title });

    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error('[recordings/start] error', error);
    const detail = process.env.NODE_ENV === 'development' ? ` ${getErrorMessage(error)}` : '';
    return NextResponse.json({ error: `Could not start recording.${detail}` }, { status: 500 });
  }
}
