/**
 * Logo rasterizer — v2.18.2 official brand assets.
 * Generates public/logo.png (512), public/logo.webp (200), and 32px PNG
 * for the ICO wrapper. Run: bun scripts/build-logo.ts
 */
import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const root = process.cwd();
const svg = readFileSync(join(root, "public/logo.svg"));

async function main() {
  await sharp(svg, { density: 300 })
    .resize(512, 512)
    .png({ compressionLevel: 9 })
    .toFile(join(root, "public/logo.png"));
  console.log("logo.png 512x512 OK");

  await sharp(svg, { density: 150 })
    .resize(200, 200)
    .webp({ quality: 92 })
    .toFile(join(root, "public/logo.webp"));
  console.log("logo.webp 200x200 OK");

  const iconSvg = readFileSync(join(root, "src/app/icon.svg"));
  await sharp(iconSvg, { density: 300 })
    .resize(32, 32)
    .png()
    .toFile(join(root, "scripts/logo/icon-32.png"));
  console.log("icon-32.png OK (favicon source)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
