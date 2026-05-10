import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const DEFAULT_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin';
const modelUrl = process.env.WHISPER_MODEL_URL || DEFAULT_URL;
const modelPath = path.resolve(process.env.WHISPER_MODEL_PATH || './models/ggml-small.bin');

await fs.promises.mkdir(path.dirname(modelPath), { recursive: true });

if (fs.existsSync(modelPath) && !process.env.FORCE_DOWNLOAD) {
  const stat = await fs.promises.stat(modelPath);
  console.log(`Model already exists at ${modelPath} (${Math.round(stat.size / 1024 / 1024)}MB).`);
  console.log('Set FORCE_DOWNLOAD=1 to download again.');
  process.exit(0);
}

console.log(`Downloading ${modelUrl}`);
console.log(`Saving to ${modelPath}`);

const response = await fetch(modelUrl);
if (!response.ok || !response.body) {
  throw new Error(`Download failed: ${response.status} ${response.statusText}`);
}

const tempPath = `${modelPath}.tmp`;
await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tempPath));
await fs.promises.rename(tempPath, modelPath);

const stat = await fs.promises.stat(modelPath);
console.log(`Downloaded ${Math.round(stat.size / 1024 / 1024)}MB.`);
