import { NextRequest, NextResponse } from 'next/server';
import { appendChunk, isValidRecordingId } from '@/lib/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isValidRecordingId(id)) {
      return NextResponse.json({ error: 'Invalid recording id.' }, { status: 400 });
    }

    const body = await req.arrayBuffer();
    if (body.byteLength === 0) {
      return NextResponse.json({ error: 'Empty chunk.' }, { status: 400 });
    }

    const totalBytes = await appendChunk(id, Buffer.from(body));
    return NextResponse.json({ ok: true, bytes: totalBytes });
  } catch (error) {
    // Only surface the known, safe rejections. Any other error (e.g. a
    // filesystem error whose message embeds an absolute path) is returned as a
    // generic message to avoid leaking local paths.
    const message = error instanceof Error ? error.message : '';
    if (message.includes('size limit')) {
      return NextResponse.json({ error: 'Recording exceeds the configured size limit.' }, { status: 413 });
    }
    if (message.includes('not found')) {
      return NextResponse.json({ error: 'Recording session not found.' }, { status: 404 });
    }
    console.error('[recordings/chunk] error', error);
    return NextResponse.json({ error: 'Could not append chunk.' }, { status: 500 });
  }
}
