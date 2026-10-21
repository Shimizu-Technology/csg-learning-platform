#!/usr/bin/env node
// Runtime-free build tooling. SVGs contain geometry/outlines; no installed font is needed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const mobile = fileURLToPath(new URL('..', import.meta.url));
const repo = path.dirname(mobile);
const brand = path.join(mobile, 'assets/brand');
const images = path.join(mobile, 'assets/images');
const evidenceIndex = process.argv.indexOf('--evidence');
const evidence = evidenceIndex < 0 ? null : path.resolve(process.argv[evidenceIndex + 1]);
const checkOnly = process.argv.includes('--check');
const read = (name) => readFile(path.join(brand, name), 'utf8');
const body = (svg) => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<title>[\s\S]*?<\/title>/g, '').replace(/<\/svg>\s*$/, '');
const svg = (content, title, viewBox = '0 0 1024 1024') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><title>${title}</title>${content}</svg>\n`;
const tile = '<rect width="1024" height="1024" fill="#191920"/>';
const mark = body(await read('csg-mark.svg'));
const lettering = body(await read('csg-lettering.svg'));
const lockup = body(await read('csg-lockup.svg'));
const gearAt = (x, y, scale) => `<g transform="translate(${x} ${y}) scale(${scale}) translate(-87 -157)">${mark}</g>`;
const lettersAt = (x, y, scale) => `<g transform="translate(${x} ${y}) scale(${scale}) translate(-238 -173)">${lettering}</g>`;
const sg = `<defs><clipPath id="sg"><rect x="285" y="165" width="100" height="65"/></clipPath></defs><g transform="translate(492 422) scale(4) translate(-285 -173)" clip-path="url(#sg)">${lettering}</g>`;
const candidates = { a: gearAt(168, 132, 4.3) + sg, b: gearAt(259, 146, 4.15), c: gearAt(346, 138, 2.7) + lettersAt(281, 697, 3.3) };
// A is the approved default. Keep the complete glyph inside r=300 (< 1024*66/108/2).
const glyph = candidates.a;
const safeGlyph = `<g transform="translate(512 512) scale(.67) translate(-512 -512)">${glyph}</g>`;
const white = (content) => content.replace(/fill="#[0-9a-f]{6}"/gi, 'fill="#ffffff"');
const sources = {
  'icon-light.svg': svg(tile + glyph, 'CSG Learn app icon'),
  'icon-dark.svg': svg(glyph, 'CSG Learn transparent dark icon'),
  'icon-tinted.svg': svg('<rect width="1024" height="1024" fill="#000000"/>' + white(glyph), 'CSG Learn tinted icon'),
  'icon-foreground.svg': svg(safeGlyph, 'CSG Learn Android adaptive foreground'),
  'icon-monochrome.svg': svg(white(safeGlyph), 'CSG Learn Android monochrome icon'),
  'notification.svg': svg(white(gearAt(170, 20, 5.6)), 'CSG Learn notification silhouette'),
  'splash-light.svg': svg(lockup.replace(/#fcfbfc/gi, '#0f172a'), 'CSG Learn light splash lockup', '72 148 392 196'),
  'splash-dark.svg': svg(lockup, 'CSG Learn dark splash lockup', '72 148 392 196'),
};
for (const [key, content] of Object.entries(candidates)) sources[`icon-candidate-${key}.svg`] = svg(tile + content, `CSG Learn candidate ${key.toUpperCase()}`);
const outputs = [
  ['icon.png', 'icon-light.svg', 1024, 1024, false],
  ['icon-light.png', 'icon-light.svg', 1024, 1024, false],
  ['icon-dark.png', 'icon-dark.svg', 1024, 1024, true],
  ['icon-tinted.png', 'icon-tinted.svg', 1024, 1024, false],
  ['icon-foreground.png', 'icon-foreground.svg', 1024, 1024, true],
  ['icon-monochrome.png', 'icon-monochrome.svg', 1024, 1024, true],
  ['splash-icon.png', 'splash-light.svg', 1024, 512, true],
  ['splash-icon-dark.png', 'splash-dark.svg', 1024, 512, true],
  ['notification-icon.png', 'notification.svg', 96, 96, true],
  ['favicon.png', 'icon-light.svg', 48, 48, false],
];
const render = (source, width, height, alpha = true) => {
  const pipeline = sharp(Buffer.from(source)).resize(width, height);
  return (alpha ? pipeline : pipeline.removeAlpha()).png();
};
const feature = svg(`${tile}<g transform="translate(15 7) scale(.33)">${glyph}</g><text x="385" y="210" fill="#fcfbfc" font-family="sans-serif" font-size="70" font-weight="700">CSG Learn</text><text x="387" y="268" fill="#fcfbfc" font-family="sans-serif" font-size="26">Code School of Guam</text><text x="387" y="340" fill="#fcfbfc" font-family="sans-serif" font-size="24">Your learning. Your community.</text>`, 'CSG Learn Google Play feature graphic', '0 0 1024 500');
const store = path.join(repo, 'docs/app-store/android/assets');
const docs = path.join(repo, 'docs/brand');
if (!checkOnly) {
  for (const [name, source] of Object.entries(sources)) await writeFile(path.join(brand, name), source);
  for (const [name, source, width, height, alpha] of outputs) await render(sources[source], width, height, alpha).toFile(path.join(images, name));
  await writeFile(path.join(store, 'feature-graphic.svg'), feature);
  await render(feature, 1024, 500, false).toFile(path.join(store, 'feature-graphic-1024x500.png'));
  await render(sources['icon-light.svg'], 512, 512, false).toFile(path.join(store, 'play-icon-512.png'));
  await writeFile(path.join(docs, 'csg-learn-app-icon.svg'), sources['icon-light.svg']);
  await writeFile(path.join(docs, 'csg-learn-mark.svg'), await read('csg-mark.svg'));
  await writeFile(path.join(docs, 'csg-learn-icon-study.svg'), svg(Object.entries(candidates).map(([key, content], i) => `<g transform="translate(${i * 1024} 0)">${tile}${content}</g>`).join(''), 'CSG Learn icon candidates A, B, C', '0 0 3072 1024'));
}
// Keep the in-app vector mark derived from the canonical SVG too.
const componentPath = path.join(mobile, 'src/components/csg-mark.tsx');
const component = `// Generated by scripts/generate-brand-assets.mjs from assets/brand/csg-mark.svg.
import { SvgXml } from 'react-native-svg';

const mark = ${JSON.stringify(await read('csg-mark.svg'))};

export function CsgMark({ width = 25, height = 36 }: { width?: number; height?: number }) {
  return <SvgXml xml={mark} width={width} height={height} accessibilityLabel="Code School of Guam" accessibilityRole="image" />;
}
`;
if (checkOnly) {
  assert.equal(await readFile(componentPath, 'utf8'), component, 'CsgMark stale; run brand:generate');
  for (const [name, expected] of Object.entries(sources)) assert.equal(await read(name), expected, `${name} stale; run brand:generate`);
} else await writeFile(componentPath, component);
const manifest = [];
for (const [name, , width, height, alpha] of outputs) {
  const file = path.join(images, name);
  const metadata = await sharp(file).metadata();
  assert.equal(metadata.width, width, `${name} width`); assert.equal(metadata.height, height, `${name} height`); assert.equal(metadata.hasAlpha, alpha, `${name} alpha`);
  // sips checks the actual platform image decoder as well as libvips metadata.
  const sips = process.platform === 'darwin' ? execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', file], { encoding: 'utf8' }).trim() : 'sips unavailable on this platform; sharp verified';
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visible = 0; let maxRadius = 0;
  for (let p = 0; p < data.length; p += 4) {
    if (!data[p + 3]) continue;
    visible++;
    if (name === 'icon-foreground.png' || name === 'icon-monochrome.png') maxRadius = Math.max(maxRadius, Math.hypot((p / 4) % info.width + .5 - 512, Math.floor(p / 4 / info.width) + .5 - 512));
    if (name === 'icon-monochrome.png' || name === 'notification-icon.png') assert.ok(data[p] === 255 && data[p + 1] === 255 && data[p + 2] === 255, `${name} must be white + alpha`);
    if (name === 'icon-tinted.png') assert.ok(data[p] === data[p + 1] && data[p] === data[p + 2], 'tinted must be grayscale');
  }
  assert.ok(visible > 0, `${name} empty`);
  if (alpha) assert.ok(visible < width * height, `${name} needs transparency`);
  if (maxRadius) assert.ok(maxRadius < 1024 * 66 / 108 / 2, `${name} outside safe circle: ${maxRadius}`);
  manifest.push({ name, width, height, alpha, maxRadius: maxRadius || undefined, sips });
  if (checkOnly) {
    const expected = await render(sources[outputs.find((o) => o[0] === name)[1]], width, height, alpha).raw().toBuffer();
    assert.ok(expected.equals(await sharp(file).raw().toBuffer()), `${name} stale; run npm run brand:generate`);
  }
}
console.log(JSON.stringify(manifest, null, 2));
if (evidence) {
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  // Native-size swatches with 60/29px examples on light/dark home-screen mockups.
  const overlays = []; const sizes = [1024, 180, 120, 60, 29];
  for (const [row, key] of Object.keys(candidates).entries()) {
    for (const [column, size] of sizes.entries()) {
      const displaySize = Math.min(size, 230);
      const png = await render(sources[`icon-candidate-${key}.svg`], size, size).resize(displaySize, displaySize).composite([{ input: Buffer.from(svg(`<rect width="${displaySize}" height="${displaySize}" rx="${displaySize * .225}" fill="white"/>`, 'iOS home screen mask', `0 0 ${displaySize} ${displaySize}`)), blend: 'dest-in' }]).toBuffer();
      for (const top of [70 + row * 275, 990 + row * 275]) overlays.push({ input: png, left: 30 + column * 258, top });
    }
  }
  const labels = svg(`<rect width="1320" height="920" fill="#e6ddd0"/><rect y="920" width="1320" height="920" fill="#242638"/>${[0,920].map(top => `<g fill="${top ? '#fff' : '#191920'}" font-family="sans-serif"><text x="30" y="${top + 30}" font-size="22">${top ? 'Dark' : 'Light'} wallpaper · A / B / C rows · 1024 (scaled to230), 180, 120, 60, 29px</text>${['A','B','C'].map((key, row) => `<text x="30" y="${top + 60 + row * 275}" font-size="18">${key}</text>${sizes.map((size, col) => `<text x="${30 + col * 258}" y="${top + 318 + row * 275}" font-size="16">CSG Learn · ${size}px</text>`).join('')}`).join('')}</g>`).join('')}`, 'CSG Learn icon candidate sizes', '0 0 1320 1840');
  await sharp(await render(labels, 1320, 1840).toBuffer()).composite(overlays).png().toFile(path.join(evidence, 'icon-candidates.png'));
  for (const key of Object.keys(candidates)) await render(sources[`icon-candidate-${key}.svg`], 1024, 1024, false).toFile(path.join(evidence, `icon-candidate-${key}-1024.png`));
  const maskPreview = svg(`<rect width="1100" height="600" fill="#faf7f0"/><defs><clipPath id="circle"><circle cx="0" cy="0" r="220"/></clipPath><clipPath id="squircle"><rect x="-220" y="-220" width="440" height="440" rx="100"/></clipPath></defs>${['circle','squircle'].map((id, i) => `<g transform="translate(${270+i*550} 280)" clip-path="url(#${id})"><g transform="translate(-220 -220) scale(.4296875)">${tile}${safeGlyph}</g></g><text x="${200+i*550}" y="550" fill="#191920" font-size="22" font-family="sans-serif">${id}</text>`).join('')}`, 'Android adaptive icon mask previews', '0 0 1100 600');
  await render(maskPreview, 1100, 600, false).toFile(path.join(evidence, 'android-adaptive-masks.png'));
  const original = await sharp(path.join(repo, 'web/public/CSG-Logo.png')).removeAlpha().raw().toBuffer();
  const rebuilt = await render(svg('<rect width="500" height="500" fill="#191920"/>'+lockup, 'Logo reconstruction', '0 0 500 500'), 500, 500, false).raw().toBuffer();
  const overlay = Buffer.alloc(original.length); const diff = Buffer.alloc(original.length);
  for (let i=0; i<original.length; i++) { overlay[i] = Math.round((original[i]+rebuilt[i])/2); diff[i] = Math.min(255, Math.abs(original[i]-rebuilt[i])*4); }
  for (const [name, buffer] of [['logo-rebuilt', rebuilt], ['logo-overlay', overlay], ['logo-diff-4x', diff]]) await sharp(buffer, { raw: {width:500,height:500,channels:3} }).png().toFile(path.join(evidence, `${name}.png`));
}
