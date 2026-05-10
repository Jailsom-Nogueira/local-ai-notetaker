import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scannedExtensions = new Set([
  '.cjs', '.css', '.js', '.json', '.jsx', '.md', '.mjs', '.ts', '.tsx', '.yml', '.yaml', '.example', ''
]);
const skippedDirs = new Set(['.git', '.hermes', '.next', 'node_modules', 'data', 'models', 'coverage']);
const forbidden = [
  { name: 'operator home path', pattern: /\/Users\/jay\b/g },
  { name: 'personal name', pattern: new RegExp(`${'Jail'}${'som'}|${'No'}${'gueira'}`, 'g') },
  { name: 'long OpenAI-style secret', pattern: /sk-[A-Za-z0-9_-]{20,}/g },
  { name: 'long provider-style secret', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g },
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute);
    if (entry.isDirectory()) {
      if (!skippedDirs.has(entry.name)) files.push(...walk(absolute));
      continue;
    }
    const ext = path.extname(entry.name);
    if (scannedExtensions.has(ext) || entry.name === '.gitignore' || entry.name === '.gitattributes') {
      files.push(relative);
    }
  }
  return files;
}

let failures = 0;
for (const relative of walk(root)) {
  const absolute = path.join(root, relative);
  const text = fs.readFileSync(absolute, 'utf8');
  for (const rule of forbidden) {
    const matches = [...text.matchAll(rule.pattern)];
    if (matches.length > 0) {
      failures += matches.length;
      for (const match of matches) {
        const line = text.slice(0, match.index).split('\n').length;
        console.error(`${relative}:${line}: ${rule.name}`);
      }
    }
  }
}

if (failures > 0) {
  console.error(`Publication check failed with ${failures} finding(s).`);
  process.exit(1);
}

console.log('Publication check passed.');
