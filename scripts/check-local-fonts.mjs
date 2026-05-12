import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const layoutPath = path.join(root, 'src', 'app', 'layout.tsx');
const cssPath = path.join(root, 'src', 'app', 'globals.css');

const [layout, css] = await Promise.all([
  readFile(layoutPath, 'utf8'),
  readFile(cssPath, 'utf8'),
]);

const violations = [];

if (layout.includes('next/font/google')) {
  violations.push('src/app/layout.tsx imports next/font/google, which makes local builds depend on Google Fonts network access.');
}

if (/var\(--font-source-(sans-3|code-pro)\)/.test(css)) {
  violations.push('src/app/globals.css depends on next/font CSS variables instead of local/system font stacks.');
}

if (violations.length > 0) {
  console.error('Local font contract failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Local font contract passed.');
