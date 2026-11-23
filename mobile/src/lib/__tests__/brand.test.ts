import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const brandKeys = [
  'EXPO_PUBLIC_LOGO_SVG', 'EXPO_PUBLIC_SCHOOL_NAME', 'EXPO_PUBLIC_PRODUCT_NAME',
  'EXPO_PUBLIC_SCHOOL_ABBREVIATION', 'EXPO_PUBLIC_SCHOOL_SHORT_NAME',
  'EXPO_PUBLIC_SUPPORT_EMAIL', 'EXPO_PUBLIC_SCHOOL_SITE_URL', 'EXPO_PUBLIC_APP_URL',
];
let previousEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  previousEnv = { ...process.env };
  for (const key of brandKeys) delete process.env[key];
});
afterEach(() => { process.env = previousEnv; });
it('keeps app display defaults unchanged', () => {
  jest.isolateModules(() => {
    const { brand } = require('../brand');
    expect(brand).toMatchObject({ schoolName: 'Code School of Guam', productName: 'CSG Learn', schoolAbbreviation: 'CSG', supportEmail: 'codeschoolofguam@gmail.com', appUrl: 'https://learn.codeschoolofguam.com' });
    expect(brand.logoSvg).toContain('<title>Code School of Guam gear C</title>');
  });
});
it('trims configuration and rejects invalid public URLs', () => {
  const { createBrand } = require('../brand');
  expect(createBrand({ EXPO_PUBLIC_SCHOOL_NAME: ' Example ', EXPO_PUBLIC_APP_URL: ' https://example.org/ ' })).toMatchObject({ schoolName: 'Example', appUrl: 'https://example.org' });
  for (const key of ['EXPO_PUBLIC_SCHOOL_SITE_URL', 'EXPO_PUBLIC_APP_URL']) {
    for (const value of ['invalid', 'http://example.org', 'javascript:alert(1)', 'https://example.org/\n/evil']) {
      expect(() => createBrand({ [key]: value })).toThrow(key);
    }
    expect(() => createBrand({ [key]: '  ' })).not.toThrow();
  }
});

it('loads environment overrides in an isolated module registry', () => {
  process.env.EXPO_PUBLIC_SCHOOL_NAME = 'Example School';
  process.env.EXPO_PUBLIC_LOGO_SVG = '<svg />';
  jest.isolateModules(() => {
    const { brand } = require('../brand');
    expect(brand).toMatchObject({ schoolName: 'Example School', logoSvg: '<svg />' });
  });
});

it('keeps runtime school/product brand literals in brand.ts outside explicitly allowlisted modules', () => {
  const srcRoot = resolve(__dirname, '../..');
  const allowlisted = /\/(__tests__|test-utils)\/|\/lib\/(brand|brand-mark|school-time|hafa-starter-links|native-content-href|demo-[^/]+)\.ts$/;
  const offenders: string[] = [];
  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'test-utils') visit(fullPath);
        continue;
      }
      if (!/\.tsx?$/.test(fullPath) || /\.test\.tsx?$/.test(fullPath) || allowlisted.test(fullPath)) continue;
      if (fullPath.endsWith('/api.generated.ts')) continue;
      const source = readFileSync(fullPath, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (/\bCode School\b|CSG Learn|codeschoolofguam\.com|codeschoolofguam@gmail\.com|https:\/\/shimizu-technology\.com/.test(source)) {
        offenders.push(fullPath.slice(srcRoot.length + 1));
      }
    }
  }
  visit(srcRoot);
  expect(offenders).toEqual([]);
});
