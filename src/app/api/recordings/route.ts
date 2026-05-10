import { NextResponse } from 'next/server';
import { listRecordings } from '@/lib/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const recordings = await listRecordings();
    return NextResponse.json({ ok: true, recordings });
  } catch (error) {
    const detail = process.env.NODE_ENV === 'development' && error instanceof Error
      ? ` ${error.message}`
      : '';
    return NextResponse.json({ error: `Failed to list recordings.${detail}` }, { status: 500 });
  }
}
