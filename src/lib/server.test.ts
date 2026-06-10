import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chunkTranscript,
  offsetSegments,
  type WhisperSegment,
} from './server.ts';

test('offsetSegments shifts start and end while preserving text', () => {
  const segments: WhisperSegment[] = [
    { start: 0, end: 5, text: 'first' },
    { start: 10, end: 12.5, text: 'second' },
  ];

  const shifted = offsetSegments(segments, 900);

  assert.deepEqual(shifted, [
    { start: 900, end: 905, text: 'first' },
    { start: 910, end: 912.5, text: 'second' },
  ]);
  // Original is not mutated.
  assert.equal(segments[0].start, 0);
});

test('offsetSegments with zero offset returns equivalent segments', () => {
  const segments: WhisperSegment[] = [{ start: 1, end: 2, text: 'x' }];
  assert.deepEqual(offsetSegments(segments, 0), segments);
});

test('chunkTranscript returns a single chunk when under the limit', () => {
  const text = 'Short transcript that fits.';
  assert.deepEqual(chunkTranscript(text, 100), [text]);
});

test('chunkTranscript returns empty array for blank input', () => {
  assert.deepEqual(chunkTranscript('   ', 100), []);
});

test('chunkTranscript splits on sentence boundaries within the limit', () => {
  const text = 'One sentence here. Two sentence here. Three sentence here.';
  const chunks = chunkTranscript(text, 25);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 25, `chunk too long: "${chunk}"`);
  }
  // No content is lost (ignoring whitespace differences).
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), text);
});

test('chunkTranscript hard-splits a sentence longer than the limit', () => {
  const longWord = 'a'.repeat(50);
  const chunks = chunkTranscript(longWord, 20);

  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 20);
  }
  assert.equal(chunks.join(''), longWord);
});
