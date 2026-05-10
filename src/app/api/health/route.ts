import { NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getOpenAIKey } from '@/lib/server';

const execFileP = promisify(execFile);
export const runtime = 'nodejs';

type Check = { ok: boolean; detail?: string };

async function commandExists(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileP(command, args, { timeout: 5000, maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const checks: Record<string, Check> = {};

  checks.ffmpeg = await commandExists('ffmpeg', ['-version'])
    ? { ok: true, detail: 'available' }
    : { ok: false, detail: 'ffmpeg not found on PATH' };

  const whisperBin = process.env.WHISPER_BIN || 'whisper-cli';
  const whisperAvailable = path.isAbsolute(whisperBin)
    ? existsSync(whisperBin)
    : await commandExists(whisperBin, ['--help']);
  checks.whisper = whisperAvailable
    ? { ok: true, detail: 'available' }
    : { ok: false, detail: 'whisper-cli not found; install whisper.cpp or set WHISPER_BIN' };

  const modelPath = process.env.WHISPER_MODEL_PATH || path.join(process.cwd(), 'models', 'ggml-small.bin');
  if (existsSync(modelPath)) {
    const stat = await fs.stat(modelPath);
    checks.model = { ok: true, detail: `${(stat.size / 1024 / 1024).toFixed(0)}MB model found` };
  } else {
    checks.model = { ok: false, detail: 'Whisper model not found; run npm run setup:model or set WHISPER_MODEL_PATH' };
  }

  const key = await getOpenAIKey();
  checks.openai = key
    ? { ok: true, detail: 'configured' }
    : { ok: false, detail: 'OPENAI_API_KEY not configured; AI review will be disabled' };

  const allOk = Object.values(checks).every(check => check.ok);
  return NextResponse.json({ ok: allOk, checks });
}
