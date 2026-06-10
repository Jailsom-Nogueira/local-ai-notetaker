import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import {
  configuredMaxAudioBytes,
  isValidRecordingId,
  readStatus,
  runProcessing,
  sessionAudioPath,
  writeStatus,
} from '@/lib/server';

export const runtime = 'nodejs';
export const maxDuration = 3600;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isValidRecordingId(id)) {
      return NextResponse.json({ error: 'Invalid recording id.' }, { status: 400 });
    }

    const body = await req.json().catch(() => null) as { durationSec?: unknown } | null;
    const durationSec = Number(body?.durationSec || 0);

    const audioPath = sessionAudioPath(id);
    let size: number;
    try {
      size = (await fs.stat(audioPath)).size;
    } catch {
      return NextResponse.json({ error: 'Recording session not found.' }, { status: 404 });
    }
    if (size < 1000) {
      return NextResponse.json({ error: 'Recording is empty.' }, { status: 400 });
    }
    if (size > configuredMaxAudioBytes()) {
      return NextResponse.json({ error: 'Recording exceeds the configured size limit.' }, { status: 413 });
    }

    const status = await readStatus(id);
    const sources = status?.sources ?? ['mic'];
    const language = status?.language ?? 'auto';
    const title = status?.title ?? '';

    await writeStatus(id, {
      state: 'processing',
      processed: 0,
      total: 0,
      sources,
      language,
      title,
      durationSec: Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0,
    });

    // Kick off processing without awaiting; the self-hosted Node process keeps
    // running and updates status. The client polls GET /api/recordings/[id].
    void runProcessing(id, audioPath, {
      sources,
      language,
      durationSec: Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0,
      title,
    });

    return NextResponse.json({ ok: true, state: 'processing' });
  } catch (error) {
    console.error('[recordings/finalize] error', error);
    const detail = process.env.NODE_ENV === 'development' ? ` ${getErrorMessage(error)}` : '';
    return NextResponse.json({ error: `Could not finalize recording.${detail}` }, { status: 500 });
  }
}
