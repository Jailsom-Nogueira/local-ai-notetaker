import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageSource = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');

test('share UI uses a Stripe-style workflow instead of a plain button row', () => {
  assert.match(pageSource, /className="share-workflow"/);
  assert.match(pageSource, /className="share-step-number"/);
  assert.match(pageSource, /className="share-destination share-destination-primary"/);
  assert.match(pageSource, /Open composer/);
  assert.match(pageSource, /Local handoff/);
});

test('share UI styling is token-based and follows the Stripe card system', () => {
  assert.match(cssSource, /--font-sans:\s*var\(--font-source-sans-3, system-ui\)/);
  assert.match(cssSource, /--font-mono:\s*var\(--font-source-code-pro, ui-monospace\)/);
  assert.match(cssSource, /\.share-card\s*{[^}]*box-shadow:\s*var\(--shadow-elevated\)/s);
  assert.match(cssSource, /\.share-card::before/s);
  assert.match(cssSource, /\.share-option\[aria-pressed="true"\]/);
  assert.match(cssSource, /\.share-destination-primary/s);
  assert.doesNotMatch(cssSource, /\.share-(?:card|option|destination)[^{]*{[^}]*#[0-9a-fA-F]{3,8}/s);
});
