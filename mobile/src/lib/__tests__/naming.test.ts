import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mobile = resolve(__dirname, '../../..');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  const file = join(dir, entry);
  return statSync(file).isDirectory() ? walk(file) : [file];
});
const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return value.replace(/%20/g, ' '); } };

describe('mobile product identity', () => {
  it('uses CSG Learn in UI source and config, including encoded and uppercase copy', () => {
    const files = [...walk(join(mobile, 'src')).filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file)), join(mobile, 'app.json')];
    expect(files.length).toBeGreaterThan(50);
    const retired = /CSG\s+Connect\b/i;
    expect(files.flatMap((file) => readFileSync(file, 'utf8').split('\n').flatMap((line, i) => retired.test(decode(line)) ? [`${file}:${i + 1}: ${line.trim()}`] : []))).toEqual([]);
  });

  it('preserves installed app, cache, EAS, Firebase, and Clerk redirect identities', () => {
    const config = JSON.parse(readFileSync(join(mobile, 'app.json'), 'utf8')).expo;
    expect(config.name).toBe('CSG Learn');
    expect(config.slug).toBe('csg-connect');
    expect(config.scheme).toEqual(['csgconnect', 'csglearn']);
    expect(config.ios.bundleIdentifier).toBe('com.codeschoolofguam.connect');
    expect(config.android.package).toBe('com.codeschoolofguam.connect');
    expect(config.extra.eas.projectId).toBe('c6326478-e200-4aba-8614-806ca5f8e03a');
    expect(config.android.googleServicesFile).toBe('./google-services.json');
    expect(JSON.parse(readFileSync(join(mobile, 'google-services.json'), 'utf8')).project_info.project_id).toBe('csg-connect-9076e');
    expect(readFileSync(join(mobile, 'src/lib/learning-cache.ts'), 'utf8')).toContain("'csg-connect.db'");
    expect(readFileSync(join(mobile, 'src/app/(auth)/sign-in.tsx'), 'utf8')).toContain("scheme: 'csgconnect'");
    expect(readFileSync(join(mobile, 'src/app/(auth)/sign-in.tsx'), 'utf8')).toContain("path: 'oauth-callback'");
  });
});
