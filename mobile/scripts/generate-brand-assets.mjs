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
const body = (svg) => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<(?:title|desc)>[\s\S]*?<\/(?:title|desc)>/g, '').replace(/<\/svg>\s*$/, '');
const svg = (content, title, viewBox = '0 0 1024 1024') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><title>${title}</title>${content}</svg>\n`;
const white = (content) => content.replace(/fill="(?:#[0-9a-f]{6}|url\([^)]+\))"/gi, 'fill="#ffffff"');
const mark = body(await read('csg-mark.svg'));
const lettering = body(await read('csg-lettering.svg'));
const sansLettering = body(await read('csg-sans-lettering.svg'));
const lockup = body(await read('csg-lockup.svg'));
const tileDef = '<radialGradient id="tile-bg" cx="50%" cy="20%" r="82%"><stop offset="0%" stop-color="#272936"/><stop offset="100%" stop-color="#14151c"/></radialGradient>';
const gearGradientDefs = `<linearGradient id="gear-sage" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#9aae81"/><stop offset="100%" stop-color="#76855f"/></linearGradient><mask id="gear-mask" maskUnits="userSpaceOnUse" x="87" y="157" width="122" height="177">${white(mark)}</mask>`;
const tile = '<rect width="1024" height="1024" fill="url(#tile-bg)"/>';
const gearAt = (x, y, scale, gradient = true) => `<g transform="translate(${x} ${y}) scale(${scale}) translate(-87 -157)">${gradient ? '<rect x="87" y="157" width="122" height="177" fill="url(#gear-sage)" mask="url(#gear-mask)"/>' : mark}</g>`;
const lettersAt = (x, y, scale) => `<g transform="translate(${x} ${y}) scale(${scale}) translate(-238 -173)">${lettering}</g>`;
const sansLettersAt = (x, y, scale) => `<g transform="translate(${x} ${y}) scale(${scale}) translate(-60 0)">${sansLettering}</g>`;
const crest = (gradient = true) => gearAt(336, 108, 3.12, gradient) + sansLettersAt(264, 724, 0.112);
const candidates = { a: crest(true), b: gearAt(259, 146, 4.15, true), c: gearAt(336, 108, 3.12, true) + lettersAt(267, 728, 3.52) };
// Option 5B (candidate A: enlarged sage gear-C + bold Manrope ExtraBold CSG) is the approved default.
// Keep the complete adaptive glyph inside r=312.88 (< 1024*66/108/2).
const glyph = candidates.a;
const monoGlyph = white(crest(false));
const adaptiveTransform = (content) => `<g transform="translate(512 512) scale(.66) translate(-512 -501)">${content}</g>`;
const safeGlyph = adaptiveTransform(glyph);
const safeMonoGlyph = adaptiveTransform(monoGlyph);
const sources = {
  'icon-light.svg': svg(`<defs>${tileDef}${gearGradientDefs}</defs>${tile}${glyph}`, 'CSG Learn app icon'),
  'icon-dark.svg': svg(`<defs>${gearGradientDefs}</defs>${glyph}`, 'CSG Learn transparent dark icon'),
  'icon-tinted.svg': svg('<rect width="1024" height="1024" fill="#000000"/>' + monoGlyph, 'CSG Learn tinted icon'),
  'icon-foreground.svg': svg(`<defs>${gearGradientDefs}</defs>${safeGlyph}`, 'CSG Learn Android adaptive foreground'),
  'icon-monochrome.svg': svg(safeMonoGlyph, 'CSG Learn Android monochrome icon'),
  'notification.svg': svg(white(gearAt(170, 20, 5.6, false)), 'CSG Learn notification silhouette'),
  'splash-light.svg': svg(lockup.replace(/#fcfbfc/gi, '#0f172a'), 'CSG Learn light splash lockup', '72 148 392 196'),
  'splash-dark.svg': svg(lockup, 'CSG Learn dark splash lockup', '72 148 392 196'),
};
for (const [key, content] of Object.entries(candidates)) sources[`icon-candidate-${key}.svg`] = svg(`<defs>${tileDef}${gearGradientDefs}</defs>${tile}${content}`, `CSG Learn candidate ${key.toUpperCase()}`);
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
const feature = svg(`<defs>${tileDef}${gearGradientDefs}</defs><rect width="1024" height="500" fill="url(#tile-bg)"/><g transform="translate(22 72) scale(.35)">${glyph}</g>${body(await read('play-feature-copy.svg'))}`, 'CSG Learn Google Play feature graphic', '0 0 1024 500');
const store = path.join(repo, 'docs/app-store/android/assets');
const docs = path.join(repo, 'docs/brand');
const textArtifacts = new Map([
  [path.join(store, 'feature-graphic.svg'), feature],
  [path.join(docs, 'csg-learn-app-icon.svg'), sources['icon-light.svg']],
  [path.join(docs, 'csg-learn-mark.svg'), await read('csg-mark.svg')],
  [path.join(docs, 'csg-learn-icon-study.svg'), svg(`<defs>${tileDef}${gearGradientDefs}</defs>` + Object.entries(candidates).map(([key, content], i) => `<g transform="translate(${i * 1024} 0)">${tile}${content}</g>`).join(''), 'CSG Learn icon candidates A, B, C', '0 0 3072 1024')],
]);
const releaseImages = [
  { file: path.join(store, 'feature-graphic-1024x500.png'), source: feature, width: 1024, height: 500 },
  { file: path.join(store, 'play-icon-512.png'), source: sources['icon-light.svg'], width: 512, height: 512 },
];
const artifactName = (file) => path.relative(repo, file);
const readArtifact = async (file) => {
  try { return await readFile(file, 'utf8'); }
  catch (error) { throw new Error(`Missing generated asset ${artifactName(file)}; run npm run brand:generate`, { cause: error }); }
};
if (!checkOnly) {
  for (const [name, source] of Object.entries(sources)) await writeFile(path.join(brand, name), source);
  for (const [name, source, width, height, alpha] of outputs) await render(sources[source], width, height, alpha).toFile(path.join(images, name));
  for (const [file, content] of textArtifacts) await writeFile(file, content);
  for (const { file, source, width, height } of releaseImages) await render(source, width, height, false).toFile(file);
} else {
  for (const [file, expected] of textArtifacts) assert.equal(await readArtifact(file), expected, `${artifactName(file)} stale; run npm run brand:generate`);
}
// Keep the in-app vector mark derived from the canonical SVG too.
const component = `// Generated by scripts/generate-brand-assets.mjs.
export const defaultLogoSvg = ${JSON.stringify(await read('csg-mark.svg'))};
`;
const brandMarkPath = path.join(repo, 'mobile/src/lib/brand-mark.ts');
if (checkOnly) {
  assert.equal(await readFile(brandMarkPath, 'utf8'), component, 'Brand mark stale; run brand:generate');
  for (const [name, expected] of Object.entries(sources)) assert.equal(await read(name), expected, `${name} stale; run brand:generate`);
} else await writeFile(brandMarkPath, component);
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
for (const { file, source, width, height } of releaseImages) {
  const name = artifactName(file);
  try {
    const metadata = await sharp(file).metadata();
    assert.equal(metadata.width, width, `${name} width`);
    assert.equal(metadata.height, height, `${name} height`);
    assert.equal(metadata.hasAlpha, false, `${name} must be opaque`);
    if (checkOnly) assert.ok((await render(source, width, height, false).raw().toBuffer()).equals(await sharp(file).raw().toBuffer()), `${name} stale; run npm run brand:generate`);
    const sips = process.platform === 'darwin' ? execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', file], { encoding: 'utf8' }).trim() : 'sips unavailable on this platform; sharp verified';
    manifest.push({ name, width, height, alpha: false, sips });
  } catch (error) { throw new Error(`Generated release asset ${name} missing, invalid, or stale; run npm run brand:generate`, { cause: error }); }
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
  const maskPreview = svg(`<rect width="1100" height="600" fill="#faf7f0"/><defs>${tileDef}${gearGradientDefs}<clipPath id="circle"><circle cx="0" cy="0" r="220"/></clipPath><clipPath id="squircle"><rect x="-220" y="-220" width="440" height="440" rx="100"/></clipPath></defs>${['circle','squircle'].map((id, i) => `<g transform="translate(${270+i*550} 280)" clip-path="url(#${id})"><g transform="translate(-220 -220) scale(.4296875)">${tile}${safeGlyph}</g></g><text x="${200+i*550}" y="550" fill="#191920" font-size="22" font-family="sans-serif">${id}</text>`).join('')}`, 'Android adaptive icon mask previews', '0 0 1100 600');
  await render(maskPreview, 1100, 600, false).toFile(path.join(evidence, 'android-adaptive-masks.png'));
  const original = await sharp(path.join(repo, 'web/public/CSG-Logo.png')).removeAlpha().raw().toBuffer();
  const rebuilt = await render(svg('<rect width="500" height="500" fill="#191920"/>'+lockup, 'Logo reconstruction', '0 0 500 500'), 500, 500, false).raw().toBuffer();
  const overlay = Buffer.alloc(original.length); const diff = Buffer.alloc(original.length);
  for (let i=0; i<original.length; i++) { overlay[i] = Math.round((original[i]+rebuilt[i])/2); diff[i] = Math.min(255, Math.abs(original[i]-rebuilt[i])*4); }
  for (const [name, buffer] of [['logo-rebuilt', rebuilt], ['logo-overlay', overlay], ['logo-diff-4x', diff]]) await sharp(buffer, { raw: {width:500,height:500,channels:3} }).png().toFile(path.join(evidence, `${name}.png`));
}
