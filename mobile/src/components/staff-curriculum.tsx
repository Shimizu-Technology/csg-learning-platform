import { Archive, ArrowRight, BookOpen, ChevronDown, ChevronUp, CircleDot, Plus, Search, Settings2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { LearningCard, SectionHeading, StatusPill } from '@/components/learning-ui';
import { fontScaleLimits, fonts, palette, typography } from '@/constants/csg-theme';
import { curriculumDayFor, curriculumWeekFor, curriculumWeeks, lessonsForWeek, searchStaffCurricula } from '@/lib/curriculum';
import type { StaffCurriculum, StaffCurriculumModule, StaffLessonSummary } from '@/lib/types';

export function CurriculumSearch({ value, onChangeText, placeholder = 'Find any module or lesson' }: { value: string; onChangeText: (value: string) => void; placeholder?: string }) {
  return <View style={styles.search}><Search color={palette.quiet} size={18} /><TextInput accessibilityLabel="Search curriculum" autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.quiet} style={styles.input} /></View>;
}

export function StaffCurriculumLibrary({ curricula, filter, onFilterChange, onOpenCurriculum, onOpenLesson }: { curricula: StaffCurriculum[]; filter: string; onFilterChange: (value: string) => void; onOpenCurriculum: (id: number) => void; onOpenLesson: (id: number) => void }) {
  const results = useMemo(() => searchStaffCurricula(curricula, filter), [curricula, filter]);
  const searching = Boolean(filter.trim());
  const visibleResults = results.slice(0, 60);

  return <>
    <LearningCard><BookOpen color={palette.rubySoft} size={25} /><Text style={styles.introTitle}>Curriculum in your pocket</Text><Text style={styles.introCopy}>Search the full learning library, inspect its schedule, and preview exactly what students will see. Preview mode never changes student records.</Text></LearningCard>
    <CurriculumSearch value={filter} onChangeText={onFilterChange} />
    {searching ? <View style={styles.section}>
      <SectionHeading eyebrow={`${results.length} ${results.length === 1 ? 'match' : 'matches'}`} title="Search results" />
      <View style={styles.stack}>{visibleResults.map((result) => <LessonRow key={`${result.curriculum.id}:${result.lesson.id}`} lesson={result.lesson} context={`${result.curriculum.name} · ${result.module.name}`} onPress={() => onOpenLesson(result.lesson.id)} />)}</View>
      {!results.length && <EmptyCopy title="No curriculum matches" copy="Try a lesson title, module name, content type, or submission method." />}
      {results.length > visibleResults.length && <Text style={styles.limitCopy}>Showing the first {visibleResults.length} matches. Add another word to narrow the list.</Text>}
    </View> : <View style={styles.section}>
      <SectionHeading eyebrow={`${curricula.length} ${curricula.length === 1 ? 'curriculum' : 'curricula'}`} title="Curriculum library" />
      <View style={styles.stack}>{curricula.map((curriculum) => {
        const lessons = curriculum.modules.reduce((sum, module) => sum + module.lessons_count, 0);
        const archived = curriculum.modules.reduce((sum, module) => sum + module.archived_lessons_count, 0);
        return <LearningCard key={curriculum.id} onPress={() => onOpenCurriculum(curriculum.id)} label={`Open ${curriculum.name}`}><View style={styles.cardTop}><View style={styles.icon}><BookOpen color={palette.rubySoft} size={21} /></View><View style={styles.flex}><View style={styles.inline}><Text style={styles.cardTitle}>{curriculum.name}</Text><StatusPill completed={curriculum.status === 'active'} label={curriculum.status} /></View><Text style={styles.cardCopy}>{curriculum.description || 'Reusable Code School curriculum'}</Text><Text style={styles.meta}>{curriculum.modules_count} modules · {lessons} active lessons{archived ? ` · ${archived} archived` : ''}</Text></View><ArrowRight color={palette.quiet} size={19} /></View></LearningCard>;
      })}</View>
      {!curricula.length && <EmptyCopy title="No curricula yet" copy="Create the first curriculum from the web studio, then it will appear here." />}
    </View>}
  </>;
}

export function StaffCurriculumDetailView({ curriculum, filter, onFilterChange, onOpenLesson, canManageModules = false, onAddModule, onEditModule, onAddLesson }: { curriculum: StaffCurriculum; filter: string; onFilterChange: (value: string) => void; onOpenLesson: (id: number) => void; canManageModules?: boolean; onAddModule?: () => void; onEditModule?: (module: StaffCurriculumModule) => void; onAddLesson?: (module: StaffCurriculumModule, week: number) => void }) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(curriculum.modules.slice(0, 1).map((module) => module.id)));
  const [selectedWeeks, setSelectedWeeks] = useState<Record<number, number>>({});
  const results = useMemo(() => searchStaffCurricula([curriculum], filter), [curriculum, filter]);
  const searching = Boolean(filter.trim());

  const toggleModule = (moduleId: number) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(moduleId)) next.delete(moduleId); else next.add(moduleId);
    return next;
  });

  return <>
    <View style={styles.curriculumHero}><View style={styles.inline}><Text style={styles.heroEyebrow}>CURRICULUM</Text><StatusPill completed={curriculum.status === 'active'} label={curriculum.status} /></View><Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.heroTitle}>{curriculum.name}</Text><Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.heroCopy}>{curriculum.description || 'Reusable Code School curriculum'}</Text><View style={styles.heroFooter}><Text style={styles.heroMeta}>{curriculum.modules_count} modules · {curriculum.total_weeks} weeks</Text>{canManageModules && onAddModule && <Pressable accessibilityRole="button" accessibilityLabel="Create module" onPress={onAddModule} style={styles.heroAction}><Plus color={palette.rubySoft} size={16} /><Text style={styles.heroActionText}>New module</Text></Pressable>}</View></View>
    <CurriculumSearch value={filter} onChangeText={onFilterChange} placeholder="Search inside this curriculum" />
    {searching ? <View style={styles.section}><SectionHeading eyebrow={`${results.length} ${results.length === 1 ? 'match' : 'matches'}`} title="Search results" /><View style={styles.stack}>{results.slice(0, 60).map((result) => <LessonRow key={result.lesson.id} lesson={result.lesson} context={result.module.name} onPress={() => onOpenLesson(result.lesson.id)} />)}</View>{!results.length && <EmptyCopy title="No lessons found" copy="Try a different title, type, or submission method." />}</View> : <View style={styles.section}><SectionHeading eyebrow="Browse by schedule" title="Modules and weeks" /><View style={styles.moduleStack}>{[...curriculum.modules].sort((a, b) => a.position - b.position).map((module) => <ModuleSchedule key={module.id} module={module} expanded={expanded.has(module.id)} selectedWeek={selectedWeeks[module.id]} onToggle={() => toggleModule(module.id)} onSelectWeek={(week) => setSelectedWeeks((current) => ({ ...current, [module.id]: week }))} onOpenLesson={onOpenLesson} canManage={canManageModules} onEdit={onEditModule ? () => onEditModule(module) : undefined} onAddLesson={onAddLesson ? (week) => onAddLesson(module, week) : undefined} />)}</View></View>}
  </>;
}

function ModuleSchedule({ module, expanded, selectedWeek, onToggle, onSelectWeek, onOpenLesson, canManage, onEdit, onAddLesson }: { module: StaffCurriculumModule; expanded: boolean; selectedWeek?: number; onToggle: () => void; onSelectWeek: (week: number) => void; onOpenLesson: (id: number) => void; canManage: boolean; onEdit?: () => void; onAddLesson?: (week: number) => void }) {
  const weeks = curriculumWeeks(module);
  const activeWeek = weeks.includes(selectedWeek || -1) ? selectedWeek! : weeks[0] || 1;
  const lessons = lessonsForWeek(module, activeWeek);
  const archived = module.lessons.filter((lesson) => lesson.archived_at).sort((a, b) => a.release_day - b.release_day || a.position - b.position);

  return <View style={styles.moduleCard}><Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${module.name}`} onPress={onToggle} style={styles.moduleHeader}><View style={styles.moduleIcon}><CircleDot color={palette.rubySoft} size={20} /></View><View style={styles.flex}><Text style={styles.moduleType}>{module.module_type.replaceAll('_', ' ')}</Text><Text style={styles.moduleTitle}>{module.name}</Text><Text style={styles.meta}>{module.lessons_count} active · {module.week_count} weeks{archived.length ? ` · ${archived.length} archived` : ''}</Text></View>{expanded ? <ChevronUp color={palette.muted} size={20} /> : <ChevronDown color={palette.muted} size={20} />}</Pressable>{expanded && <View style={styles.moduleBody}>
    {module.description && <Text style={styles.moduleCopy}>{module.description}</Text>}
    <View style={styles.moduleActions}>{onAddLesson && <Pressable accessibilityRole="button" accessibilityLabel={`Add lesson to ${module.name}`} onPress={() => onAddLesson(activeWeek)} style={styles.addLesson}><Plus color={palette.text} size={16} /><Text style={styles.addLessonText}>Add lesson</Text></Pressable>}{canManage && onEdit && <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${module.name} settings`} onPress={onEdit} style={styles.moduleSettings}><Settings2 color={palette.muted} size={16} /><Text style={styles.moduleSettingsText}>Settings</Text></Pressable>}</View>
    {weeks.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weekRow}>{weeks.map((week) => <Pressable key={week} accessibilityRole="button" accessibilityState={{ selected: activeWeek === week }} onPress={() => onSelectWeek(week)} style={[styles.weekChip, activeWeek === week && styles.weekChipActive]}><Text style={[styles.weekText, activeWeek === week && styles.weekTextActive]}>Week {week}</Text></Pressable>)}</ScrollView>}
    <View style={styles.stack}>{lessons.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} context={`${curriculumDayFor(lesson)} · ${lesson.content_blocks_count} blocks`} onPress={() => onOpenLesson(lesson.id)} />)}</View>
    {!lessons.length && <EmptyCopy title="No active lessons" copy="This week does not contain published curriculum yet." />}
    {archived.length > 0 && <View style={styles.archived}><View style={styles.archivedHeading}><Archive color={palette.warning} size={16} /><Text style={styles.archivedTitle}>Archived lessons</Text></View>{archived.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} context={`Week ${curriculumWeekFor(lesson)} · ${curriculumDayFor(lesson)}`} onPress={() => onOpenLesson(lesson.id)} />)}</View>}
  </View>}</View>;
}

function LessonRow({ lesson, context, onPress }: { lesson: StaffLessonSummary; context: string; onPress: () => void }) {
  const submissionLabel = lesson.submission_type === 'manual_complete' ? 'review' : lesson.submission_type.replaceAll('_submission', '').replaceAll('_', ' + ');
  return <Pressable accessibilityRole="button" accessibilityLabel={`Preview ${lesson.title}`} onPress={onPress} style={({ pressed }) => [styles.lessonRow, pressed && styles.pressed]}><View style={[styles.lessonDot, lesson.archived_at && styles.lessonDotArchived]}><BookOpen color={lesson.archived_at ? palette.warning : palette.rubySoft} size={17} /></View><View style={styles.flex}><View style={styles.lessonTitleRow}><Text numberOfLines={2} style={styles.lessonTitle}>{lesson.title}</Text>{!lesson.required && <Text style={styles.optional}>OPTIONAL</Text>}</View><Text style={styles.lessonContext}>{context}</Text><Text style={styles.lessonMeta}>{lesson.lesson_type.replaceAll('_', ' ')} · {submissionLabel}{lesson.archived_at ? ' · archived' : ''}</Text></View><ArrowRight color={palette.quiet} size={17} /></Pressable>;
}

function EmptyCopy({ title, copy }: { title: string; copy: string }) {
  return <View style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyCopy}>{copy}</Text></View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 }, inline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, section: { gap: 12, marginTop: 5 }, stack: { gap: 8 }, moduleStack: { gap: 10 },
  search: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 },
  introTitle: { ...typography.section, color: palette.text, fontFamily: fonts.bold, marginTop: 14 }, introCopy: { ...typography.support, color: palette.muted, fontFamily: fonts.regular, marginTop: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 11 }, icon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, cardTitle: { flex: 1, color: palette.text, fontFamily: fonts.bold, fontSize: 15 }, cardCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 5 }, meta: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, marginTop: 4 },
  curriculumHero: { borderRadius: 22, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', padding: 20 }, heroEyebrow: { ...typography.label, color: palette.rubySoft, fontFamily: fonts.bold, letterSpacing: 1.2 }, heroTitle: { ...typography.title, color: palette.text, fontFamily: fonts.extraBold, letterSpacing: -0.7, marginTop: 14 }, heroCopy: { ...typography.support, color: palette.muted, fontFamily: fonts.regular, marginTop: 7 }, heroFooter: { minHeight: 44, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, heroMeta: { flex: 1, color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 }, heroAction: { minHeight: 44, borderRadius: 14, backgroundColor: '#351821', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }, heroActionText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11 },
  moduleCard: { borderRadius: 20, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, overflow: 'hidden' }, moduleHeader: { minHeight: 76, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11 }, moduleIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, moduleType: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }, moduleTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 15, marginTop: 2 }, moduleBody: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, padding: 14, gap: 12 }, moduleCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 }, moduleActions: { flexDirection: 'row', gap: 8 }, addLesson: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, addLessonText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, moduleSettings: { minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 }, moduleSettingsText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11 },
  weekRow: { gap: 7, paddingVertical: 1 }, weekChip: { minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center' }, weekChipActive: { borderColor: palette.ruby, backgroundColor: '#351821' }, weekText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11 }, weekTextActive: { color: palette.rubySoft },
  lessonRow: { minHeight: 74, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, pressed: { opacity: 0.82 }, lessonDot: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, lessonDotArchived: { backgroundColor: '#2A2115' }, lessonTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 }, lessonTitle: { flex: 1, color: palette.text, fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 }, optional: { color: palette.warning, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5 }, lessonContext: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, marginTop: 3 }, lessonMeta: { color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, marginTop: 3, textTransform: 'capitalize' },
  archived: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, paddingTop: 12, gap: 8 }, archivedHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 }, archivedTitle: { color: palette.warning, fontFamily: fonts.bold, fontSize: 12 },
  empty: { paddingVertical: 26, paddingHorizontal: 16, alignItems: 'center' }, emptyTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 14 }, emptyCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 5 }, limitCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, textAlign: 'center' },
});
