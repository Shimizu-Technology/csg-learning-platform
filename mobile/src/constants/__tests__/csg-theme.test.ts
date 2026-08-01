import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { fontScaleLimits, palette, typography } from '../csg-theme';

function relativeLuminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  if (!channels || channels.length !== 3) throw new Error(`Invalid color: ${hex}`);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : ['.ts', '.tsx'].includes(extname(path)) ? [path] : [];
  });
}

describe('native design tokens', () => {
  it('keeps every meaningful semantic text role at 11pt or larger', () => {
    expect(Object.values(typography).every((role) => role.fontSize >= 11)).toBe(true);
    expect(Object.values(typography).every((role) => role.lineHeight >= role.fontSize * 1.2)).toBe(true);
  });

  it('allows body and utility text to reach at least 200 percent', () => {
    expect(fontScaleLimits.content).toBeGreaterThanOrEqual(2);
    expect(fontScaleLimits.utility).toBeGreaterThanOrEqual(2);
  });

  it.each([palette.ink, palette.panel, palette.panelRaised])(
    'keeps subtle readable text above 4.5:1 on %s',
    (background) => expect(contrast(palette.subtle, background)).toBeGreaterThanOrEqual(4.5),
  );

  it('does not reintroduce undersized or low-contrast readable text styles', () => {
    const violations = sourceFiles(resolve(__dirname, '../..')).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      const smallType = [...source.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)]
        .filter((match) => Number(match[1]) < 11)
        .map((match) => `${path}: ${match[0]}`);
      const quietText = [...source.matchAll(/color:\s*palette\.quiet/g)]
        .map((match) => `${path}: ${match[0]}`);
      return [...smallType, ...quietText];
    });

    expect(violations).toEqual([]);
  });
});
