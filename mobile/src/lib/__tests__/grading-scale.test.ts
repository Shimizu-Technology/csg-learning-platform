import { gradeFromRubric, gradeOnScale, passingChoicesFor, suggestedPassingGrade } from '../grading-scale';

describe('grading scales', () => {
  it('offers each scale its passing grades', () => {
    expect(passingChoicesFor('pass_redo')).toEqual(['P']);
    expect(passingChoicesFor('letter_abc_redo')).toEqual(['A', 'B', 'C']);
    expect(passingChoicesFor(undefined)).toEqual(['A', 'B', 'C']);
    expect(suggestedPassingGrade('suggest_pass')).toBe('P');
    expect(suggestedPassingGrade('suggest_b')).toBe('B');
    expect(suggestedPassingGrade('review_for_redo')).toBeNull();
    expect(gradeOnScale('A', 'pass_redo')).toBeNull();
    expect(gradeOnScale('R', 'pass_redo')).toBe('R');
    expect(gradeOnScale('P', 'letter_abc_redo')).toBeNull();
    expect(gradeOnScale('B', 'letter_abc_redo')).toBe('B');
  });

  it('reads a grade from rubric ratings the same way the web app does', () => {
    expect(gradeFromRubric('pass_redo', ['meets', null])).toBeNull();
    expect(gradeFromRubric('pass_redo', ['redo', null])).toBe('R');
    expect(gradeFromRubric('pass_redo', ['developing', 'meets'])).toBe('P');
    expect(gradeFromRubric('letter_abc_redo', ['exceeds', 'exceeds'])).toBe('A');
    expect(gradeFromRubric('letter_abc_redo', ['exceeds', 'exceeds', 'meets'])).toBe('A');
    expect(gradeFromRubric('letter_abc_redo', ['exceeds', 'meets'])).toBe('B');
    expect(gradeFromRubric('letter_abc_redo', ['exceeds', 'developing'])).toBe('C');
  });
});
