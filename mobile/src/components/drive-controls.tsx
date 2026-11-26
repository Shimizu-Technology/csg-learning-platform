import { ArrowDownUp, ChevronLeft, Folder, FolderOpen, LayoutGrid, List } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/constants/csg-theme';
import {
  DRIVE_SORT_LABELS,
  nextDriveSort,
  type DriveFolderSummary,
  type DriveSort,
  type DriveTypeFilter,
  type DriveViewMode,
} from '@/lib/drive-helpers';
import { makeStyles, useTheme } from '@/providers/theme-provider';

const TYPE_OPTIONS: { value: DriveTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'doc', label: 'Docs' },
  { value: 'file', label: 'Files' },
  { value: 'link', label: 'Links' },
];

export function DriveFolderStrip({
  folders,
  activeFolder,
  rootLabel,
  onSelectFolder,
}: {
  folders: DriveFolderSummary[];
  activeFolder: string;
  rootLabel: string;
  onSelectFolder: (folder: string) => void;
}) {
  const styles = useStyles();
  const { colors: c } = useTheme();

  if (activeFolder !== 'All') {
    return (
      <View style={styles.breadcrumbRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Back to ${rootLabel}`}
          onPress={() => onSelectFolder('All')}
          style={styles.breadcrumbBack}
        >
          <ChevronLeft color={c.text.body} size={17} />
          <Text style={styles.breadcrumbBackText}>{rootLabel}</Text>
        </Pressable>
        <Text style={styles.breadcrumbSep}>/</Text>
        <Text numberOfLines={1} style={styles.breadcrumbCurrent}>{activeFolder}</Text>
      </View>
    );
  }

  if (folders.length <= 1) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.strip}
      contentContainerStyle={styles.folderRow}
      keyboardShouldPersistTaps="handled"
    >
      {folders.map((folder) => {
        const selected = activeFolder === folder.name;
        return (
          <Pressable
            key={folder.name}
            accessibilityRole="button"
            accessibilityLabel={`Open folder ${folder.name}, ${folder.count} ${folder.count === 1 ? 'item' : 'items'}`}
            accessibilityState={{ selected }}
            onPress={() => onSelectFolder(folder.name)}
            style={[styles.folderCard, selected && styles.folderCardSelected]}
          >
            <View style={styles.folderIconWrap}>
              {selected ? <FolderOpen color={c.action.primary} size={18} /> : <Folder color={c.text.body} size={18} />}
            </View>
            <View style={styles.folderCopy}>
              <Text numberOfLines={1} style={styles.folderName}>{folder.name}</Text>
              <Text style={styles.folderMeta}>
                {folder.count} {folder.count === 1 ? 'item' : 'items'}
                {folder.needsReviewCount > 0 ? ` · ${folder.needsReviewCount} review` : ''}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function DriveFilterBar({
  typeFilter,
  onTypeFilterChange,
  sort,
  onSortChange,
  viewMode,
  onViewModeChange,
  showNeedsReview = false,
  needsReviewCount = 0,
}: {
  typeFilter: DriveTypeFilter;
  onTypeFilterChange: (next: DriveTypeFilter) => void;
  sort: DriveSort;
  onSortChange: (next: DriveSort) => void;
  viewMode: DriveViewMode;
  onViewModeChange: (next: DriveViewMode) => void;
  showNeedsReview?: boolean;
  needsReviewCount?: number;
}) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const options = showNeedsReview
    ? [...TYPE_OPTIONS, { value: 'needs_review' as const, label: needsReviewCount > 0 ? `Review (${needsReviewCount})` : 'Review' }]
    : TYPE_OPTIONS;

  return (
    <View style={styles.filterWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.strip}
        contentContainerStyle={styles.pillRow}
        keyboardShouldPersistTaps="handled"
      >
        {options.map((option) => {
          const active = typeFilter === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onTypeFilterChange(option.value)}
              style={[styles.pill, active && styles.pillActive]}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.utilityRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sort files, currently ${DRIVE_SORT_LABELS[sort]}`}
          onPress={() => onSortChange(nextDriveSort(sort))}
          style={styles.utilityButton}
        >
          <ArrowDownUp color={c.text.body} size={15} />
          <Text style={styles.utilityText}>{DRIVE_SORT_LABELS[sort]}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={viewMode === 'list' ? 'Switch to grid view' : 'Switch to list view'}
          onPress={() => onViewModeChange(viewMode === 'list' ? 'grid' : 'list')}
          style={styles.viewToggle}
        >
          {viewMode === 'list' ? <LayoutGrid color={c.text.body} size={17} /> : <List color={c.text.body} size={17} />}
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  strip: { flexGrow: 0, flexShrink: 0 },
  folderRow: { gap: 10, paddingRight: 16 },
  folderCard: {
    minHeight: 56,
    minWidth: 158,
    maxWidth: 220,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.raised,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  folderCardSelected: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg },
  folderIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: c.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderCopy: { flex: 1, minWidth: 0 },
  folderName: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 },
  folderMeta: { color: c.text.muted, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
  breadcrumbRow: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.sunken,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  breadcrumbBack: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 4 },
  breadcrumbBackText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 13 },
  breadcrumbSep: { color: c.text.muted, fontFamily: fonts.semibold, fontSize: 13 },
  breadcrumbCurrent: { flex: 1, color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 },
  filterWrap: { gap: 8 },
  pillRow: { gap: 8, paddingRight: 16, alignItems: 'center' },
  pill: {
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.raised,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  pillActive: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg },
  pillText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 13 },
  pillTextActive: { color: c.text.strong },
  utilityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  utilityButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.raised,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  utilityText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 },
  viewToggle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
