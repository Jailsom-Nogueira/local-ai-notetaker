import { NextResponse } from 'next/server';
import { listPendingSessions, listRecordings } from '@/lib/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const [recordings, pending] = await Promise.all([
      listRecordings(),
      listPendingSessions(),
    ]);
    return NextResponse.json({ ok: true, recordings, pending });
  } catch (error) {
    const detail = process.env.NODE_ENV === 'development' && error instanceof Error
      ? ` ${error.message}`
      : '';
    return NextResponse.json({ error: `Failed to list recordings.${detail}` }, { status: 500 });
  }
}
