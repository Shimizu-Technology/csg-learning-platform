import { isHafaStarterLink, webLessonUrl, withLessonReturn } from '../hafa-starter-links';

const STARTER = 'https://code.shimizu-technology.com/?lang=python#project=z.abc-_&starter=csg-python-pilot:e1';

describe('Hafa Code starter links', () => {
  it('recognises only Hafa Code project or starter links', () => {
    expect(isHafaStarterLink(STARTER)).toBe(true);
    expect(isHafaStarterLink('https://code.shimizu-technology.com/')).toBe(false);
    expect(isHafaStarterLink('https://code.shimizu-technology.com.evil.example/#project=x')).toBe(false);
    expect(isHafaStarterLink('http://code.shimizu-technology.com/#project=x')).toBe(false);
  });

  it('appends the web lesson as the return target without touching the project payload', () => {
    const url = withLessonReturn(STARTER, { url: webLessonUrl(130, 2), label: 'E1 — predict,\n run' });
    expect(url.startsWith(`${STARTER}&return=`)).toBe(true);
    const hash = new URLSearchParams(url.split('#')[1]);
    expect(hash.get('return')).toBe('https://learn.codeschoolofguam.com/lessons/130?cohort_id=2');
    expect(hash.get('returnLabel')).toBe('E1 — predict, run');
  });

  it('leaves links alone when they already name a return or are not starters', () => {
    const withReturn = `${STARTER}&return=https%3A%2F%2Flearn.codeschoolofguam.com%2Flessons%2F1`;
    expect(withLessonReturn(withReturn, { url: webLessonUrl(2) })).toBe(withReturn);
    expect(withLessonReturn('https://docs.python.org', { url: webLessonUrl(2) })).toBe('https://docs.python.org');
    expect(webLessonUrl(5, null)).toBe('https://learn.codeschoolofguam.com/lessons/5');
  });
});
