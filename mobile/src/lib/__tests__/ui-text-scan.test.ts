import { isLabelLike, rawEnumRenders, scanUiSource, titleCaseWords } from '../../test-utils/ui-text-scan';

/* The scanner is a heuristic over native JSX; these samples are shaped like real screens. */

const labelsIn = (source: string) => scanUiSource(source, 'sample.tsx')
  .filter((item) => isLabelLike(item))
  .map((item) => ({ text: item.text, reason: item.labelReason }));

const flagged = (source: string) => scanUiSource(source, 'sample.tsx')
  .filter((item) => isLabelLike(item) && titleCaseWords(item.text).length > 0)
  .map((item) => item.text);

describe('native heading and button contexts', () => {
  it('reads accessibilityRole="header" Text as a heading (weekly-plan.tsx)', () => {
    const source = `export function Card() {
      return <View style={styles.header}><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.eyebrow}>WEEK {plan.week_number}</Text><Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.heading}>This Week</Text><Text style={styles.headerCopy}>Required work stays clear when you work ahead.</Text></View>;
    }`;
    expect(labelsIn(source)).toEqual([{ text: 'This Week', reason: 'role:header' }]);
    expect(flagged(source)).toEqual(['This Week']);
  });

  it('reads Text inside a pressable as a button label', () => {
    const source = `export function Row() {
      return <>
        <Pressable accessibilityRole="button" accessibilityLabel="Browse the alumni learning library" onPress={open} style={({ pressed }) => [styles.libraryButton, pressed && styles.pressed]}><BookOpen size={17} /><Text style={styles.libraryButtonText}>Browse The Library</Text></Pressable>
        <View accessibilityRole="button"><Text style={styles.copy}>Open Details</Text></View>
        <TouchableOpacity onPress={save}><Text>Save Changes</Text></TouchableOpacity>
        <Button variant="secondary" onPress={go}>Open Lesson</Button>
        {items.map((item) => <PressableScale key={item.id} onPress={go}><Text>Mark Done</Text></PressableScale>)}
      </>;
    }`;
    expect(labelsIn(source)).toEqual([
      { text: 'Browse the alumni learning library', reason: null },
      { text: 'Browse The Library', reason: 'style:libraryButtonText' },
      { text: 'Open Details', reason: 'role:button' },
      { text: 'Save Changes', reason: 'in:TouchableOpacity' },
      { text: 'Open Lesson', reason: 'in:Button' },
      { text: 'Mark Done', reason: 'in:PressableScale' },
    ]);
  });

  it('reads title and heading style names, including style arrays', () => {
    const source = `export function Hero() {
      return <View>
        <Text style={[styles.sectionTitle, done && styles.done]}>Next Steps</Text>
        <Text style={styles.title}>Your Progress</Text>
        <Text style={styles.headerCopy}>Body Copy Stays Out</Text>
        <Text style={styles.moduleMeta}>Also Not A Label</Text>
      </View>;
    }`;
    expect(labelsIn(source)).toEqual([
      { text: 'Next Steps', reason: 'style:sectionTitle' },
      { text: 'Your Progress', reason: 'style:title' },
    ]);
  });

  it('leaves body copy and long sentences alone', () => {
    const source = `export function Body() {
      return <Pressable onPress={go}><Text style={styles.copy}>Revisit every topic, watch current and past class recordings, and use the optional exercises whenever they help.</Text></Pressable>;
    }`;
    expect(labelsIn(source)).toEqual([]);
  });

  it('accepts sentence case in those contexts', () => {
    const source = `export function Ok() {
      return <View><Text accessibilityRole="header">This week</Text><Pressable><Text>Back to Today</Text></Pressable></View>;
    }`;
    expect(flagged(source)).toEqual([]);
  });
});

describe('raw enum renders', () => {
  it('finds enum fields rendered as JSX children or copy props', () => {
    const source = `export function Card() {
      return <View>
        <Text style={styles.moduleType}>{module.module_type}</Text>
        <Text>{enrollment.cohort_name} · {enrollment.status}</Text>
        <StatusPill label={curriculum.status} />
        <Text>{\`Type: \${block.submission_type}\`}</Text>
        <Text>{member.email || member.role}</Text>
      </View>;
    }`;
    expect(rawEnumRenders(source, 'sample.tsx').map((hit) => `${hit.line} ${hit.field}`)).toEqual([
      '3 module_type', '4 status', '5 status', '6 submission_type', '7 role',
    ]);
  });

  it('ignores labelled values, comparisons, keys and styles', () => {
    const source = `export function Card() {
      return <View key={item.status} style={[item.status === 'active' && styles.active]}>
        <Text>{learnerModuleTypeLabel(module.module_type)}</Text>
        <Text>{humanize(enrollment.status, ENROLLMENT_STATUS_LABELS)}</Text>
        {item.status !== 'published' && <Text>Draft</Text>}
        <StatusPill completed={curriculum.status === 'active'} label={humanize(curriculum.status)} />
      </View>;
    }`;
    expect(rawEnumRenders(source, 'sample.tsx')).toEqual([]);
  });
});
