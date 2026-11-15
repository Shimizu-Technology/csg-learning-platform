import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isLabelLike, PROPER_NOUNS, scanUiFiles, titleCaseWords, uiSources } from '../../test-utils/ui-text-scan';

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
    expect(config.ios.infoPlist.CFBundleName).toBe('CSG Learn');
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

/*
 * The glossary (redesign README §2, fixtures/glossary.json, shared with web):
 * retired names must not appear in display copy. The scanner
 * (src/test-utils/ui-text-scan.ts) is a heuristic, so a pass means "no known
 * retired names", not proof. Routes, params, storage keys and payload keys keep
 * their names; only strings a person reads are checked.
 *
 * Adding an exception: when the word means something else in that file (block
 * a user, a Markdown code block), add `'<file> <term>': '<why>'`, where <term>
 * is the `term` from glossary.json. Exceptions that no longer match fail.
 */
const glossary = JSON.parse(readFileSync(resolve(mobile, '../fixtures/glossary.json'), 'utf8')) as { retired: { term: string; pattern: string; flags: string; use: string }[] };
const TERM_EXCEPTIONS: Record<string, string> = {
  'src/app/(app)/(tabs)/profile.tsx Record (developer word)': 'Account deletion request: "class records" matches the privacy policy wording (same exception on web)',
  'src/components/community-standards-gate.tsx Record (developer word)': 'Quotes the privacy policy category "learning records" (same exception on web)',
  'src/components/voice-draft-controls.tsx Record (developer word)': 'The verb: record audio for a voice draft',
  'src/hooks/use-voice-draft.ts Record (developer word)': 'The verb: record audio for a voice draft',
  'src/components/staff-curriculum.tsx Block counts for learners': 'Staff-only curriculum browser; blocks are the authoring term (README §2: Block, authoring only)',
  'src/lib/learning-cache.ts Entity / payload': 'SQLite statements (a column named payload), not copy',
  'src/lib/rich-text-editor.ts Entity / payload': 'Editor WebView source (a JavaScript variable named payload), not copy',
};

/** Files allowed to turn stored values into words (a time zone id, the label helpers). */
const ENUM_HUMANIZERS = new Set(['src/lib/school-time.ts', 'src/lib/display-labels.ts']);
/** Synthetic demo content: lesson titles and people's names are data, not labels. */
const DEMO_DATA = /^src\/lib\/demo-[\w-]+\.ts$/;

const sources = uiSources(mobile, 'src');
const copy = scanUiFiles(mobile, sources);

describe('mobile glossary', () => {
  const retired = glossary.retired.map((entry) => ({ ...entry, regex: new RegExp(entry.pattern, entry.flags) }));

  it('finds the copy it checks', () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(copy.length).toBeGreaterThan(500);
    expect(copy.some((item) => item.text === 'Today')).toBe(true);
  });

  it('uses one name per concept: no retired names in display copy', () => {
    const offending = copy.flatMap((item) => retired
      .filter((entry) => entry.regex.test(item.text) && !TERM_EXCEPTIONS[`${item.file} ${entry.term}`])
      .map((entry) => `${item.file}:${item.line} "${item.text.slice(0, 120)}" uses ${entry.term}; use ${entry.use}`));
    expect(offending.sort().join('\n')).toBe('');
  });

  it('keeps every exception in use', () => {
    const stale = Object.keys(TERM_EXCEPTIONS).filter((key) => {
      const [file, ...rest] = key.split(' ');
      const entry = retired.find((item) => item.term === rest.join(' '));
      return !entry || !copy.some((item) => item.file === file && entry.regex.test(item.text));
    });
    expect(stale).toEqual([]);
  });

  it('shows stored values through a label, never as raw enum text', () => {
    const offending = sources.filter((file) => !ENUM_HUMANIZERS.has(file)).flatMap((file) => readFileSync(join(mobile, file), 'utf8').split('\n')
      .map((line, index) => ({ line, at: `${file}:${index + 1}` }))
      .filter(({ line }) => /replaceAll\(\s*['"]_['"]\s*,\s*['"] ['"]\s*\)|replace\(\s*\/_\/g\s*,\s*['"] ['"]\s*\)/.test(line))
      .map(({ at }) => `${at}: use a label map`));
    expect(offending.join('\n')).toBe('');
  });
});

/* Sentence case for titles, tab labels, buttons and headings (README §2, U-6.6). */
describe('mobile sentence case', () => {
  it('detects Title Case', () => {
    expect(titleCaseWords('Save Changes')).toEqual(['Changes']);
    expect(titleCaseWords('Back to Today')).toEqual([]);
    expect(titleCaseWords('Week 2 · Loops')).toEqual([]);
    expect(PROPER_NOUNS.has('GitHub')).toBe(true);
  });

  it('writes labels, buttons, titles and headings in sentence case', () => {
    const offending = copy.filter((item) => !DEMO_DATA.test(item.file) && isLabelLike(item))
      .map((item) => ({ item, words: titleCaseWords(item.text) }))
      .filter(({ words }) => words.length > 0)
      .map(({ item, words }) => `${item.file}:${item.line} "${item.text}" (${words.join(', ')})`);
    expect(offending.join('\n')).toBe('');
  });
});
