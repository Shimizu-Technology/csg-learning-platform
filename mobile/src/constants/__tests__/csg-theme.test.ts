import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { themes, typography } from '../csg-theme';
import { contrastRatio } from '../../test-utils/contrast';

describe.each(Object.values(themes))('$scheme token contrast', (theme) => {
  const c = theme.colors;
  const pairs: [string, string, string, number][] = [];
  for (const [surface, bg] of Object.entries(c.surface)) {
    if (surface === 'inverse') continue;
    pairs.push([`strong / ${surface}`, c.text.strong, bg, 4.5], [`body / ${surface}`, c.text.body, bg, 4.5]);
  }
  // Muted is for page/raised text. Placeholder and border are decorative tokens,
  // never standalone body text; inputs use body. Sunken text uses body as well.
  pairs.push(['muted / raised', c.text.muted, c.surface.raised, 4.5], ['muted UI / page (large text or icons only)', c.text.muted, c.surface.page, 3]);
  for (const [role, pair] of Object.entries(c.status)) pairs.push([role, pair.fg, pair.bg, 4.5]);
  for (const [role, bg] of Object.entries(c.action)) pairs.push([role, c.text.onAction, bg, 4.5]);
  pairs.push(['selection', c.text.strong, c.selection.bg, 4.5], ['code', c.code.fg, c.code.bg, 4.5], ['inline code', c.text.strong, c.surface.sunken, 4.5], ['code support', c.code.muted, c.code.bg, 4.5], ['code copied', c.code.success, c.code.bg, 4.5], ['media', c.media.fg, c.media.bg, 4.5], ['media error', c.media.danger, c.media.bg, 4.5], ['focus', c.focus, c.surface.page, 3]);
  it.each(pairs)('%s', (_label, fg, bg, minimum) => expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(minimum));
});
it('keeps semantic text at 12pt or larger and preserves font scaling', () => {
  expect(Object.values(typography).every((role) => role.fontSize >= 12)).toBe(true);
  // PR 3a migrates the shell; the all-screen source guard lands in 3b.
  const shell = ['community-standards-gate.tsx', 'weekly-plan.tsx', 'learning-ui.tsx'];
  const violations = shell.map((filename) => resolve(__dirname, '../../components', filename))
    .flatMap((p) => [...readFileSync(p, 'utf8').matchAll(/fontSize:\s*(\d+)/g)].filter((m) => Number(m[1]) < 12).map((m) => `${p}: ${m[0]}`));
  expect(violations).toEqual([]);
});

it('keeps the fixed brand tile consistent across appearances', () => {
  expect(themes.light.colors.brand.tile).toBe('#191920');
  expect(themes.dark.colors.brand.tile).toBe(themes.light.colors.brand.tile);
});
