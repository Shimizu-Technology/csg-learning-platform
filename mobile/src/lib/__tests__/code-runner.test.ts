import { codeRunnerLanguageForFilename, normalizeCodeRunnerConfig, submissionConfigWithRunner } from '../code-runner';

describe('mobile curriculum code runner settings', () => {
  it('uses JavaScript for JavaScript and TypeScript filenames and Ruby otherwise', () => {
    expect(codeRunnerLanguageForFilename('exercise.tsx')).toBe('javascript');
    expect(codeRunnerLanguageForFilename('lesson.JS')).toBe('javascript');
    expect(codeRunnerLanguageForFilename('challenge.rb')).toBe('ruby');
    expect(codeRunnerLanguageForFilename('README.md')).toBe('ruby');
  });

  it('normalizes malformed settings without enabling the runner', () => {
    expect(normalizeCodeRunnerConfig({ runner: { enabled: 'yes', language: 'python' } }, 'javascript')).toEqual({ enabled: false, language: 'javascript' });
    expect(normalizeCodeRunnerConfig({ runner: { enabled: true, language: 'ruby' } }, 'javascript')).toEqual({ enabled: true, language: 'ruby' });
  });

  it('preserves unrelated submission configuration and disables execution outside text submissions', () => {
    expect(submissionConfigWithRunner({ review: { mode: 'guided' } }, { enabled: true, language: 'javascript' }, false)).toEqual({
      review: { mode: 'guided' },
      runner: { enabled: false, language: 'javascript' },
    });
  });

  it('keeps starter code and checks authored on the web', () => {
    const checks = [{ id: 'c1', name: 'Adds', code: 'assert_equal 3, add(1, 2)' }];
    expect(submissionConfigWithRunner({ runner: { enabled: true, language: 'ruby', starter_code: 'def add', checks } }, { enabled: false, language: 'javascript' }, true)).toEqual({
      runner: { enabled: false, language: 'javascript', starter_code: 'def add', checks },
    });
  });
});
