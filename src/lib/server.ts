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
    if (!entry.endsWith('.json')) continue;
    // Skip server-side sidecar files: ffmpeg intermediate WAV JSON, status, and segment outputs.
    if (entry.includes('.16k.') || entry.includes('.status.') || entry.includes('.seg-')) continue;
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

// ----------------------------------------------------------------------------
// Long-recording lifecycle: streamed capture, chunked transcription, status.
// ----------------------------------------------------------------------------

export const ALLOWED_LANGUAGES = new Set(['auto', 'en', 'pt', 'es']);
export const ALLOWED_SOURCES = new Set(['mic', 'system']);

const DEFAULT_MAX_AUDIO_BYTES = 200 * 1024 * 1024;

/** How often processing rewrites status during a long segment, so the client
 * can distinguish a working job from a stalled one. */
export const HEARTBEAT_MS = 20000;

export function configuredMaxAudioBytes(): number {
  const value = Number(process.env.MAX_AUDIO_BYTES || DEFAULT_MAX_AUDIO_BYTES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_AUDIO_BYTES;
}

/** Transcription segment length in seconds. Long audio is split into pieces of
 * this size so whisper.cpp runs incrementally with progress instead of one
 * blocking pass over many hours of audio. */
function segmentSeconds(): number {
  const value = Number(process.env.NOTETAKER_SEGMENT_SECONDS || 900);
  return Number.isFinite(value) && value >= 30 ? value : 900;
}

/** Maximum characters per transcript window for map-reduce AI review. */
export function reviewMapChars(): number {
  const value = Number(process.env.NOTETAKER_REVIEW_MAP_CHARS || 24000);
  return Number.isFinite(value) && value > 1000 ? value : 24000;
}

export function newRecordingId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2).padEnd(5, '0').slice(0, 5);
  return `rec-${ts}-${rand}`;
}

export function sessionAudioPath(id: string): string {
  return path.join(RECORDINGS_DIR, `${assertRecordingId(id)}.webm`);
}

function statusPath(id: string): string {
  return path.join(RECORDINGS_DIR, `${assertRecordingId(id)}.status.json`);
}

export type RecordingStatus = {
  state: 'recording' | 'processing' | 'done' | 'error';
  processed: number;
  total: number;
  sources?: string[];
  language?: string;
  title?: string;
  durationSec?: number;
  error?: string;
  updatedAt: string;
};

export async function writeStatus(
  id: string,
  status: Omit<RecordingStatus, 'updatedAt'>
): Promise<void> {
  await ensureRecordingsDir();
  const payload: RecordingStatus = { ...status, updatedAt: new Date().toISOString() };
  await fs.writeFile(statusPath(id), JSON.stringify(payload, null, 2));
}

export async function readStatus(id: string): Promise<RecordingStatus | null> {
  if (!isValidRecordingId(id)) return null;
  try {
    return JSON.parse(await fs.readFile(statusPath(id), 'utf8')) as RecordingStatus;
  } catch {
    return null;
  }
}

export async function clearStatus(id: string): Promise<void> {
  if (!isValidRecordingId(id)) return;
  try { await fs.unlink(statusPath(id)); } catch {}
}

/**
 * Begin a streamed recording session: create an empty local audio file and a
 * `recording` status so chunks can be appended as they arrive from the browser.
 */
export async function startRecordingSession(
  id: string,
  meta: { sources: string[]; language: string; title: string }
): Promise<void> {
  await ensureRecordingsDir();
  await fs.writeFile(sessionAudioPath(id), Buffer.alloc(0));
  await writeStatus(id, {
    state: 'recording',
    processed: 0,
    total: 0,
    sources: meta.sources,
    language: meta.language,
    title: meta.title,
  });
}

/**
 * Append an ordered audio chunk to the session file. Enforces the cumulative
 * upload cap so a runaway session cannot fill the disk.
 */
export async function appendChunk(id: string, chunk: Buffer): Promise<number> {
  const audioPath = sessionAudioPath(id);
  let currentSize: number;
  try {
    currentSize = (await fs.stat(audioPath)).size;
  } catch {
    throw new Error('Recording session not found.');
  }
  if (currentSize + chunk.byteLength > configuredMaxAudioBytes()) {
    throw new Error('Recording exceeds the configured size limit.');
  }
  await fs.appendFile(audioPath, chunk);
  return currentSize + chunk.byteLength;
}

/**
 * Split a 16 kHz WAV into fixed-length segments via ffmpeg so each piece can be
 * transcribed independently. Returns segment paths in chronological order.
 */
export async function splitWavIntoSegments(wavPath: string, seconds: number): Promise<string[]> {
  const base = wavPath.replace(/\.wav$/, '');
  const pattern = `${base}.seg-%03d.wav`;

  await execFileP('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', wavPath,
    '-f', 'segment',
    '-segment_time', String(seconds),
    '-c', 'copy',
    pattern,
  ], { maxBuffer: 50 * 1024 * 1024 });

  const dir = path.dirname(wavPath);
  const prefix = `${path.basename(base)}.seg-`;
  const entries = await fs.readdir(dir);
  return entries
    .filter(entry => entry.startsWith(prefix) && entry.endsWith('.wav'))
    .sort()
    .map(entry => path.join(dir, entry));
}

/** Shift segment timestamps by a fixed offset (seconds). Pure helper used when
 * stitching per-segment whisper output back into one timeline. */
export function offsetSegments(segments: WhisperSegment[], offsetSeconds: number): WhisperSegment[] {
  return segments.map(segment => ({
    start: segment.start + offsetSeconds,
    end: segment.end + offsetSeconds,
    text: segment.text,
  }));
}

/**
 * Transcribe arbitrarily long audio by splitting into segments, running
 * whisper-cli on each, and stitching the results with offset timestamps.
 */
export async function transcribeLongAudio(
  wavPath: string,
  modelPath: string,
  whisperBin: string,
  language: string,
  seconds: number,
  onProgress?: (processed: number, total: number) => void
): Promise<{ text: string; segments: WhisperSegment[]; language: string; total: number }> {
  const segmentPaths = await splitWavIntoSegments(wavPath, seconds);
  const total = segmentPaths.length;
  const allSegments: WhisperSegment[] = [];
  let detectedLanguage = language;
  let resolvedLanguage = false;

  for (let i = 0; i < segmentPaths.length; i++) {
    const segPath = segmentPaths[i];
    const offset = i * seconds;
    const result = await transcribeWithWhisper(segPath, modelPath, whisperBin, language);

    if (!resolvedLanguage && result.language && result.language !== 'auto') {
      detectedLanguage = result.language;
      resolvedLanguage = true;
    }
    allSegments.push(...offsetSegments(result.segments, offset));

    try { await fs.unlink(segPath); } catch {}
    try { await fs.unlink(segPath.replace(/\.wav$/, '.json')); } catch {}
    onProgress?.(i + 1, total);
  }

  const text = allSegments.map(segment => segment.text).join(' ').replace(/\s+/g, ' ').trim();
  return { text, segments: allSegments, language: detectedLanguage, total };
}

export type ProcessInput = {
  sources: string[];
  language: string;
  durationSec: number;
  title: string;
};

/**
 * Normalize, transcribe (chunked), and persist a recording from a local audio
 * file. Updates status throughout so the client can poll progress. Shared by
 * the single-shot upload route and the streamed-session finalize route.
 */
export async function processRecording(
  id: string,
  audioPath: string,
  input: ProcessInput
): Promise<RecordingMeta> {
  const modelPath = process.env.WHISPER_MODEL_PATH || path.join(process.cwd(), 'models', 'ggml-small.bin');
  const whisperBin = process.env.WHISPER_BIN || 'whisper-cli';
  const seconds = segmentSeconds();
  const baseStatus = {
    sources: input.sources,
    language: input.language,
    title: input.title,
    durationSec: input.durationSec,
  };

  // Track progress so a heartbeat can keep advancing `updatedAt` even during a
  // single long segment. A stalled `updatedAt` lets the client detect a lost or
  // hung job (e.g. after a server restart) instead of polling forever.
  let processed = 0;
  let total = 0;
  const writeProcessing = () =>
    writeStatus(id, { state: 'processing', processed, total, ...baseStatus });

  await writeProcessing();

  const wavPath = await convertToWav16k(audioPath);

  const heartbeat = setInterval(() => { void writeProcessing(); }, HEARTBEAT_MS);
  let result: { text: string; segments: WhisperSegment[]; language: string; total: number };
  try {
    result = await transcribeLongAudio(
      wavPath,
      modelPath,
      whisperBin,
      input.language,
      seconds,
      (done, count) => {
        processed = done;
        total = count;
        void writeProcessing();
      }
    );
  } finally {
    clearInterval(heartbeat);
    try { await fs.unlink(wavPath); } catch {}
  }

  const firstSentence = result.text.split(/[.?!]/)[0] || 'Untitled note';
  const niceTitle = input.title || firstSentence.slice(0, 80).trim();

  const meta: RecordingMeta = {
    id,
    createdAt: new Date().toISOString(),
    durationSec: Number.isFinite(input.durationSec) ? Math.max(0, input.durationSec) : 0,
    title: niceTitle || 'Untitled note',
    sources: input.sources.length ? input.sources : ['mic'],
    transcript: result.text,
    segments: result.segments,
    language: result.language,
    review: null,
  };
  await saveRecording(meta);
  await writeStatus(id, {
    state: 'done',
    processed: result.total,
    total: result.total,
    sources: meta.sources,
    language: meta.language,
    title: meta.title,
    durationSec: meta.durationSec,
  });
  return meta;
}

/**
 * Run processing without throwing, recording a generic error in status. Used by
 * the finalize route which kicks off processing without awaiting it.
 */
export async function runProcessing(id: string, audioPath: string, input: ProcessInput): Promise<void> {
  try {
    await processRecording(id, audioPath, input);
  } catch (error) {
    console.error('[process] error', error);
    await writeStatus(id, {
      state: 'error',
      processed: 0,
      total: 0,
      sources: input.sources,
      language: input.language,
      title: input.title,
      durationSec: input.durationSec,
      error: 'Transcription failed.',
    }).catch(() => {});
  }
}

/**
 * Split transcript text into windows no larger than `maxChars`, breaking on
 * sentence boundaries where possible. Used for map-reduce AI review.
 */
export type PendingSession = {
  id: string;
  state: RecordingStatus['state'];
  processed: number;
  total: number;
  title?: string;
  durationSec?: number;
  updatedAt: string;
};

/**
 * List recording sessions that have a status file but no finalized JSON yet.
 * Used for crash recovery: a tab close or server restart can leave a session
 * captured-but-unprocessed, which the UI can offer to finish.
 */
export async function listPendingSessions(): Promise<PendingSession[]> {
  await ensureRecordingsDir();
  const entries = await fs.readdir(RECORDINGS_DIR);
  const pending: PendingSession[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.status.json')) continue;
    const id = entry.slice(0, -'.status.json'.length);
    if (!isValidRecordingId(id)) continue;

    try {
      await fs.access(recordingJsonPath(id));
      continue; // Finalized recording already exists.
    } catch {
      // No finalized JSON; this is a pending session.
    }

    const status = await readStatus(id);
    if (!status) continue;
    pending.push({
      id,
      state: status.state,
      processed: status.processed,
      total: status.total,
      title: status.title,
      durationSec: status.durationSec,
      updatedAt: status.updatedAt,
    });
  }

  pending.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return pending;
}

export function chunkTranscript(text: string, maxChars: number): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  const sentences = clean.split(/(?<=[.?!])\s+/);
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    if (current.length + sentence.length + 1 > maxChars) {
      if (current) chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
