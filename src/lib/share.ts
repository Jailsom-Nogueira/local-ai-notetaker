export type ShareSection = 'transcript' | 'review';
export type ShareChannel = 'email' | 'whatsapp';

export type ShareSegment = {
  start: number;
  end: number;
  text: string;
};

export type ShareAiReview = {
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

export type ShareRecording = {
  id: string;
  createdAt: string;
  durationSec: number;
  title: string;
  sources: string[];
  transcript: string;
  segments: ShareSegment[];
  language?: string;
  review?: ShareAiReview | null;
};

export type SharePayload = {
  subject: string;
  body: string;
  sections: ShareSection[];
};

export const SHARE_LONG_TEXT_THRESHOLD = 7000;

function cleanText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function formatDuration(sec: number): string {
  const safeSec = Number.isFinite(sec) && sec > 0 ? sec : 0;
  const h = Math.floor(safeSec / 3600);
  const m = Math.floor((safeSec % 3600) / 60);
  const s = Math.floor(safeSec % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function bulletList(items: string[], ordered = false): string {
  const cleaned = items.map(cleanText).filter(Boolean);
  if (cleaned.length === 0) return '';
  return cleaned.map((item, index) => ordered ? `${index + 1}. ${item}` : `- ${item}`).join('\n');
}

export function resolveShareSections(recording: ShareRecording, sections: ShareSection[]): ShareSection[] {
  const requested = new Set(sections);
  const resolved: ShareSection[] = [];

  if (requested.has('transcript') && hasTranscript(recording)) {
    resolved.push('transcript');
  }
  if (requested.has('review') && recording.review) {
    resolved.push('review');
  }

  if (resolved.length === 0) {
    if (hasTranscript(recording)) return ['transcript'];
    if (recording.review) return ['review'];
  }

  return resolved;
}

export function hasTranscript(recording: ShareRecording): boolean {
  return recording.segments.some(segment => cleanText(segment.text).length > 0) || cleanText(recording.transcript).length > 0;
}

export function formatTranscriptForShare(recording: ShareRecording): string {
  const segmentLines = recording.segments
    .map(segment => {
      const text = cleanText(segment.text);
      if (!text) return '';
      return `[${formatDuration(segment.start)}] ${text}`;
    })
    .filter(Boolean);

  if (segmentLines.length > 0) return segmentLines.join('\n');

  const transcript = cleanText(recording.transcript);
  return transcript || '(empty transcript)';
}

export function formatReviewForShare(review: ShareAiReview): string {
  const blocks: string[] = [];
  const summary = cleanText(review.summary);
  if (summary) blocks.push(`Summary\n${summary}`);

  const keyPoints = bulletList(review.keyPoints, true);
  if (keyPoints) blocks.push(`Key points\n${keyPoints}`);

  const actionItems = bulletList(review.actionItems);
  if (actionItems) blocks.push(`Action items\n${actionItems}`);

  const decisions = bulletList(review.decisions);
  if (decisions) blocks.push(`Decisions\n${decisions}`);

  const questions = bulletList(review.questions);
  if (questions) blocks.push(`Open questions\n${questions}`);

  const topics = review.topics.map(cleanText).filter(Boolean);
  if (topics.length > 0) blocks.push(`Topics\n${topics.join(', ')}`);

  blocks.push(`Sentiment: ${review.sentiment}`);

  return blocks.join('\n\n');
}

export function buildSharePayload(recording: ShareRecording, sections: ShareSection[]): SharePayload {
  const resolvedSections = resolveShareSections(recording, sections);
  const bodyBlocks = [
    recording.title,
    `Created: ${new Date(recording.createdAt).toLocaleString()}`,
    `Duration: ${formatDuration(recording.durationSec)}`,
    `Sources: ${recording.sources.length > 0 ? recording.sources.join(' + ') : 'mic'}`,
  ];

  if (recording.language) bodyBlocks.push(`Language: ${recording.language.toUpperCase()}`);

  for (const section of resolvedSections) {
    if (section === 'transcript') {
      bodyBlocks.push(`Transcript\n${formatTranscriptForShare(recording)}`);
    }

    if (section === 'review' && recording.review) {
      bodyBlocks.push(`AI Review\n${formatReviewForShare(recording.review)}`);
    }
  }

  return {
    subject: `Notetaker: ${recording.title}`,
    body: bodyBlocks.map(cleanText).filter(Boolean).join('\n\n'),
    sections: resolvedSections,
  };
}

export function formatShareMessage(payload: SharePayload): string {
  return `${payload.subject}\n\n${payload.body}`;
}

export function buildShareUrl(channel: ShareChannel, payload: SharePayload): string {
  if (channel === 'email') {
    return `mailto:?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.body)}`;
  }

  return `https://api.whatsapp.com/send?text=${encodeURIComponent(formatShareMessage(payload))}`;
}

export function isLongSharePayload(payload: SharePayload): boolean {
  return formatShareMessage(payload).length > SHARE_LONG_TEXT_THRESHOLD;
}
