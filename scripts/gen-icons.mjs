import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

// AUDIT FIX (Finding 7.1 — hardcoded project path removed):
// The root is now resolved relative to this script's own location (works in
// any checkout, CI, or Docker), with an optional PROJECT_ROOT override for
// non-standard layouts. The previous `/home/z/my-project` constant broke the
// script everywhere outside the original author's machine and leaked the
// developer's home directory into source control.
const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = process.env.PROJECT_ROOT || resolve(scriptDir, '..');
const src = join(root, 'public/logo.png');
const outDir = join(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

const logo = readFileSync(src);

// Standard "any" purpose icons — 192, 512, 1024 (for high-res installs)
await sharp(logo).resize(192, 192, { fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } }).png().toFile(join(outDir, 'icon-192.png'));
await sharp(logo).resize(512, 512, { fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } }).png().toFile(join(outDir, 'icon-512.png'));
await sharp(logo).resize(1024, 1024, { fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } }).png().toFile(join(outDir, 'icon-1024.png'));

// Maskable icons — 80% safe zone with padding so Android adaptive icons crop cleanly
const pad192 = { top: 19, bottom: 19, left: 19, right: 19, background: { r: 15, g: 23, b: 42, alpha: 1 } };
const pad512 = { top: 51, bottom: 51, left: 51, right: 51, background: { r: 15, g: 23, b: 42, alpha: 1 } };
await sharp(logo).resize(154, 154, { fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } }).extend(pad192).png().toFile(join(outDir, 'maskable-192.png'));
await sharp(logo).resize(410, 410, { fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } }).extend(pad512).png().toFile(join(outDir, 'maskable-512.png'));

// Apple touch icon — 180x180, no transparency (iOS requires solid bg)
await sharp(logo).resize(180, 180, { fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } }).png().toFile(join(outDir, 'apple-touch-icon.png'));

// Favicon — 32x32
await sharp(logo).resize(32, 32, { fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } }).png().toFile(join(root, 'public/favicon-32.png'));

console.log('Icons generated successfully');
