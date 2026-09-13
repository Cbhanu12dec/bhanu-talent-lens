// Regenerates every exported brand asset from src/lib/brandMark.js.
// Run with: npm run brand
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { iconSvg, lockupSvg, BRAND } from '../src/lib/brandMark.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const brand = path.join(pub, 'assets', 'brand');
mkdirSync(brand, { recursive: true });

const written = [];
function svg(dir, name, content) {
  writeFileSync(path.join(dir, name), content + '\n');
  written.push(path.relative(root, path.join(dir, name)));
}
async function png(dir, name, source, size) {
  const buf = await sharp(Buffer.from(source), { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(path.join(dir, name), buf);
  written.push(`${path.relative(root, path.join(dir, name))} (${size}x${size})`);
  return buf;
}

// ICO is a 6-byte header plus one 16-byte directory entry per image. Modern
// browsers accept raw PNG payloads inside the container, so no BMP encoding
// is needed and this avoids pulling in another dependency.
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + pngs.length * 16;
  const entries = [];
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map(p => p.buf)]);
}

const run = async () => {
  // --- Lockups ---------------------------------------------------------
  svg(brand, 'logo-full-light.svg', lockupSvg({ theme: 'light', idPrefix: 'fl', tagline: true, secondary: true }));
  svg(brand, 'logo-full-dark.svg', lockupSvg({ theme: 'dark', idPrefix: 'fd', tagline: true, secondary: true }));
  svg(brand, 'logo-horizontal-light.svg', lockupSvg({ theme: 'light', idPrefix: 'hl', tagline: false }));
  svg(brand, 'logo-horizontal-dark.svg', lockupSvg({ theme: 'dark', idPrefix: 'hd', tagline: false }));

  // --- Icons -----------------------------------------------------------
  const iconLight = iconSvg({ px: 512, idPrefix: 'il' });
  svg(brand, 'logo-icon.svg', iconLight);
  svg(brand, 'logo-icon-light.svg', iconLight);
  svg(brand, 'logo-icon-dark.svg', iconSvg({ px: 512, idPrefix: 'id' }));

  // --- Favicons (simplified: the 12-unit rules vanish below ~24px) ------
  const fav = iconSvg({ px: 64, detail: 'simple', idPrefix: 'fv' });
  svg(pub, 'favicon.svg', fav);
  const p16 = await png(pub, 'favicon-16x16.png', fav, 16);
  const p32 = await png(pub, 'favicon-32x32.png', fav, 32);
  const p48 = await sharp(Buffer.from(fav), { density: 384 }).resize(48, 48).png().toBuffer();
  writeFileSync(path.join(pub, 'favicon.ico'), ico([
    { size: 16, buf: p16 }, { size: 32, buf: p32 }, { size: 48, buf: p48 }
  ]));
  written.push('public/favicon.ico (16/32/48)');

  // iOS ignores transparency and composites onto black, so this one is
  // flattened onto white with breathing room inside the safe area.
  const touch = iconSvg({ px: 180, idPrefix: 'ti', background: BRAND.paper, pad: 34 });
  await png(pub, 'apple-touch-icon.png', touch, 180);

  // --- Social ----------------------------------------------------------
  const social = iconSvg({ px: 1024, idPrefix: 'so', background: BRAND.paper, pad: 40 });
  await png(brand, 'logo-social-512.png', social, 512);
  await png(brand, 'logo-social-1024.png', social, 1024);

  console.log('Brand assets written:\n' + written.map(w => '  ' + w).join('\n'));
};

run().catch(e => { console.error(e); process.exit(1); });
