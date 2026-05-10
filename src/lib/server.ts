import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);

export type WhisperSegment = { start: number; end: number; text: string };

export const RECORDING_ID_PATTERN = /^rec-\d{8}-\d{6}-[a-z0-9]{5}$/;

export function isValidRecordingId(id: string): boolean {
  return RECORDING_ID_PATTERN.test(id);
}

export function assertRecordingId(id: string): string {
  if (!isValidRecordingId(id)) {
    throw new Error('Invalid recording id.');
  }
  return id;
}

/**
 * Resolve an API key from the environment. On macOS only, fall back to a
 * same-named Keychain item (`security find-generic-password -s <name> -w`).
 */
async function getKey(name: string): Promise<string | null> {
  const envValue = process.env[name]?.trim();
  if (envValue) return envValue;
  if (process.platform !== 'darwin') return null;

  try {
    const { stdout } = await execFileP('security', [
      'find-generic-password', '-s', name, '-w',
    ]);
    const key = stdout.trim();
    return key || null;
  } catch {
    return null;
  }
}

export const getOpenAIKey = () => getKey('OPENAI_API_KEY');

/**
 * Convert any audio buffer (webm/ogg/wav/mp4) to 16 kHz mono WAV through
 * ffmpeg. Loudness normalization improves distant room speech for Whisper.
 * The caller owns cleanup of the generated WAV file.
 */
export async function convertToWav16k(inputPath: string): Promise<string> {
  const outPath = inputPath.replace(/\.[^.]+$/, '') + '.16k.wav';

  await execFileP('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', inputPath,
    '-ac', '1', '-ar', '16000',
    '-af', 'highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95',
    '-c:a', 'pcm_s16le',
    outPath,
  ], { maxBuffer: 50 * 1024 * 1024 });

  return outPath;
}

type WhisperJsonSegment = {
  offsets?: { from?: number; to?: number };
  text?: string;
};

type WhisperJson = {
  result?: { language?: unknown };
  params?: { language?: unknown };
  transcription?: unknown;
};

function asWhisperSegment(value: unknown): WhisperSegment | null {
  if (!value || typeof value !== 'object') return null;
  const segment = value as WhisperJsonSegment;
  const text = typeof segment.text === 'string' ? segment.text.trim() : '';
  if (!text) return null;

  return {
    start: Number(segment.offsets?.from ?? 0) / 1000,
    end: Number(segment.offsets?.to ?? 0) / 1000,
    text,
  };
}

/**
 * Run whisper-cli on a 16 kHz mono WAV. Returns transcript segments and the
 * detected or forced ISO 639-1 language code.
 */
export async function transcribeWithWhisper(
  wavPath: string,
  modelPath: string,
  whisperBin = 'whisper-cli',
  language: string = 'auto'
): Promise<{ text: string; segments: WhisperSegment[]; language: string }> {
  const baseArgs = [
    '-m', modelPath,
    '-f', wavPath,
    '-oj',
    '-of', wavPath.replace(/\.wav$/, ''),
    '-l', language === 'auto' ? 'auto' : language,
    '-t', String(Math.max(2, os.cpus().length - 2)),
    '--no-speech-thold', '0.3',
    '--temperature', '0',
  ];

  await execFileP(whisperBin, [...baseArgs, '--no-prints'], {
    maxBuffer: 100 * 1024 * 1024,
  }).catch(async () => {
    await execFileP(whisperBin, baseArgs, { maxBuffer: 100 * 1024 * 1024 });
  });

  const jsonPath = wavPath.replace(/\.wav$/, '.json');
  const raw = await fs.readFile(jsonPath, 'utf8');
  const parsed = JSON.parse(raw) as WhisperJson;
  const detectedLanguage =
    typeof parsed.result?.language === 'string'
      ? parsed.result.language
      : typeof parsed.params?.language === 'string'
        ? parsed.params.language
        : language || 'unknown';

  const rawSegments = Array.isArray(parsed.transcription) ? parsed.transcription : [];
  const segments = rawSegments
    .map(asWhisperSegment)
    .filter((segment): segment is WhisperSegment => segment !== null);

  const text = segments.map(segment => segment.text).join(' ').replace(/\s+/g, ' ').trim();
  return { text, segments, language: detectedLanguage };
}

export function formatTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const RECORDINGS_DIR =
  process.env.RECORDINGS_DIR || path.join(process.cwd(), 'data', 'recordings');

export async function ensureRecordingsDir() {
  await fs.mkdir(RECORDINGS_DIR, { recursive: true });
}

export type RecordingMeta = {
  id: string;
  createdAt: string;
  durationSec: number;
  title: string;
  sources: string[];
  transcript: string;
  segments: WhisperSegment[];
  language?: string;
  review?: AiReview | null;
};

export type AiReview = {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  decisions: string[];
  questions: string[];
  topics: string[];
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  generatedAt: string;
  model: string;
};

function recordingJsonPath(id: string): string {
  return path.join(RECORDINGS_DIR, `${assertRecordingId(id)}.json`);
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  await ensureRecordingsDir();
  const entries = await fs.readdir(RECORDINGS_DIR);
  const metas: RecordingMeta[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry.includes('.16k.')) continue;
    const id = entry.slice(0, -'.json'.length);
    if (!isValidRecordingId(id)) continue;

    try {
      const parsed = JSON.parse(await fs.readFile(path.join(RECORDINGS_DIR, entry), 'utf8')) as Partial<RecordingMeta>;
      if (parsed.id === id && typeof parsed.transcript === 'string') {
        metas.push(parsed as RecordingMeta);
      }
    } catch {
      // Ignore corrupt or partial metadata files so one bad local recording does not break the app.
    }
  }

  metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return metas;
}

export async function saveRecording(meta: RecordingMeta) {
  await ensureRecordingsDir();
  await fs.writeFile(recordingJsonPath(meta.id), JSON.stringify(meta, null, 2));
}

export async function loadRecording(id: string): Promise<RecordingMeta | null> {
  if (!isValidRecordingId(id)) return null;

  try {
    return JSON.parse(await fs.readFile(recordingJsonPath(id), 'utf8')) as RecordingMeta;
  } catch {
    return null;
  }
}
