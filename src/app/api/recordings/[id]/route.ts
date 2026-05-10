import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RECORDINGS_DIR, isValidRecordingId, loadRecording } from '@/lib/server';

export const runtime = 'nodejs';

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isValidRecordingId(id)) {
      return NextResponse.json({ error: 'Invalid recording id.' }, { status: 400 });
    }

    const rec = await loadRecording(id);
    if (!rec) return NextResponse.json({ error: 'Recording not found.' }, { status: 404 });

    const entries = await fs.readdir(RECORDINGS_DIR);
    for (const entry of entries) {
      if (entry.startsWith(`${id}.`) || entry === `${id}.json`) {
        try { await fs.unlink(path.join(RECORDINGS_DIR, entry)); } catch {}
      }
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Delete failed.' }, { status: 500 });
  }
}
