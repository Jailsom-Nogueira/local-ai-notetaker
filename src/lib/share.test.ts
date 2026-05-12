import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSharePayload,
  buildShareUrl,
  formatShareMessage,
  resolveShareSections,
  type ShareRecording,
} from './share.ts';

const recording: ShareRecording = {
  id: 'rec-20260512-134107-ig5px',
  createdAt: '2026-05-12T13:41:07.000Z',
  durationSec: 125,
  title: 'Sprint planning',
  sources: ['mic', 'system'],
  transcript: 'Fallback transcript should not be used when segments exist.',
  segments: [
    { start: 0, end: 5, text: 'We agreed to ship the dashboard.' },
    { start: 65, end: 70, text: 'Jay will follow up with design.' },
  ],
  language: 'en',
  review: {
    summary: 'The team aligned on dashboard launch scope.',
    keyPoints: ['Dashboard remains the priority', 'Design review is required'],
    actionItems: ['Jay: follow up with design'],
    decisions: ['Ship the dashboard first'],
    questions: ['Do we need a beta flag?'],
    topics: ['Dashboard', 'Design'],
    sentiment: 'positive',
    generatedAt: '2026-05-12T13:45:00.000Z',
    model: 'gpt-4.1-mini',
  },
};

test('buildSharePayload formats transcript-only shares with timestamps', () => {
  const payload = buildSharePayload(recording, ['transcript']);

  assert.equal(payload.subject, 'Notetaker: Sprint planning');
  assert.deepEqual(payload.sections, ['transcript']);
  assert.match(payload.body, /Duration: 00:02:05/);
  assert.match(payload.body, /Sources: mic \+ system/);
  assert.match(payload.body, /Transcript/);
  assert.match(payload.body, /\[00:00:00\] We agreed to ship the dashboard\./);
  assert.match(payload.body, /\[00:01:05\] Jay will follow up with design\./);
  assert.doesNotMatch(payload.body, /AI Review/);
  assert.doesNotMatch(payload.body, /Fallback transcript/);
});

test('buildSharePayload formats combined transcript and AI review shares', () => {
  const payload = buildSharePayload(recording, ['transcript', 'review']);

  assert.deepEqual(payload.sections, ['transcript', 'review']);
  assert.match(payload.body, /Transcript/);
  assert.match(payload.body, /AI Review/);
  assert.match(payload.body, /Summary\nThe team aligned on dashboard launch scope\./);
  assert.match(payload.body, /Key points\n1\. Dashboard remains the priority/);
  assert.match(payload.body, /Action items\n- Jay: follow up with design/);
  assert.match(payload.body, /Decisions\n- Ship the dashboard first/);
  assert.match(payload.body, /Open questions\n- Do we need a beta flag\?/);
  assert.match(payload.body, /Topics\nDashboard, Design/);
  assert.match(payload.body, /Sentiment: positive/);
});

test('resolveShareSections skips unavailable AI review and falls back to transcript', () => {
  const withoutReview: ShareRecording = { ...recording, review: null };

  assert.deepEqual(resolveShareSections(withoutReview, ['review']), ['transcript']);
  assert.deepEqual(resolveShareSections(withoutReview, ['transcript', 'review']), ['transcript']);
});

test('buildShareUrl encodes email and WhatsApp composer URLs', () => {
  const payload = buildSharePayload(recording, ['review']);
  const message = formatShareMessage(payload);

  assert.equal(
    buildShareUrl('email', payload),
    `mailto:?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(payload.body)}`
  );
  assert.equal(
    buildShareUrl('whatsapp', payload),
    `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`
  );
});
