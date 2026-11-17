import { brand } from '../../../lib/brand'
import { switchColors } from '@/constants/csg-theme';
import { Button } from '@/components/ui/button';
import { haptic } from '@/lib/haptics';
import { themedAlert as Alert } from '@/lib/alerts';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Archive, Bell, CheckCheck, ChevronRight, FileCheck2, Inbox, Megaphone, MessageCircle, PenLine, Pin, Send, Users, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormattedMessage } from '@/components/formatted-message';
import { MessageFormattingToolbar } from '@/components/message-formatting-toolbar';
import { messageBodyForSend } from '@/lib/code-paste';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fontScaleLimits, fonts, typography } from '@/constants/csg-theme';
import { UPDATES_STALE_TIME, useUpdatesFocusRefresh } from '@/hooks/use-updates-focus-refresh';
import { learningKeys } from '@/lib/learning';
import { messagingKeys } from '@/lib/messaging-cache';
import { demoAnnouncements, demoNotifications } from '@/lib/demo-data';
import { mobileNotificationPath, notificationTitle } from '@/lib/notification-path';
import type { components } from '@/lib/api.generated';
import type { Announcement, AppNotification, PaginationMeta } from '@/lib/types';
import { mapUpdatePages, readAllAnnouncements, readAllNotifications, readAnnouncementPages, readAnnouncementNotificationPages, readNotification, uniqueUpdates, updatesKeys, type AnnouncementListPayload, type NotificationListPayload, type PagedUpdates, upsertAnnouncement } from '@/lib/updates-cache';
import { isScheduledUpdate, sendsAboutLabel } from '@/lib/scheduled-updates';
import { useCsgAuth } from '@/providers/auth-provider';
import { useCohort } from '@/providers/cohort-provider';
import { useSession } from '@/providers/session-provider';
import { useWorkspace } from '@/providers/workspace-provider';
import { formatCourseDate, formatCourseDateTime } from '@/lib/course-time';
import { markdownExcerpt } from '@/lib/plain-text';
import { humanize } from '@/lib/display-labels';

type Section = 'announcements' | 'inbox';
const generateRequestId = () => `update-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

function demoMeta(totalCount: number): PaginationMeta {
  return { page: 1, per_page: 50, total_count: totalCount, total_pages: totalCount ? 1 : 0, has_next_page: false, has_prev_page: false };
}

export default function UpdatesScreen() {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const router = useRouter();
  const { cohort_id, announcement_id } = useLocalSearchParams<{ cohort_id?: string; announcement_id?: string }>();
  const routedCohortId = cohort_id && Number(cohort_id) > 0 ? Number(cohort_id) : null;
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const { cohorts, selectedCohortId } = useCohort();
  const routedCohortIsAccessible = Boolean(routedCohortId && cohorts.some((cohort) => cohort.id === routedCohortId));
  const focusedCohortId = routedCohortId ?? selectedCohortId;
  const isStaff = Boolean(user?.is_staff);
  const { workspaces } = useWorkspace();
  const queryClient = useQueryClient();
  const userId = user?.id ?? 0;
  const [section, setSection] = useState<Section>('announcements');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const createRequestId = useRef<string | null>(null);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    if (!routedCohortId || !routedCohortIsAccessible) return;
    // The provider owns route-driven selection and its accessible notice.
    if (selectedCohortId !== routedCohortId) return;
    router.setParams({ cohort_id: undefined });
  }, [routedCohortId, routedCohortIsAccessible, router, selectedCohortId]);
  const announcementKey = useMemo(() => updatesKeys.announcements(userId, managing && isStaff, focusedCohortId), [focusedCohortId, isStaff, managing, userId]);
  const notificationKey = useMemo(() => updatesKeys.notifications(userId), [userId]);
  const announcementQuery = useInfiniteQuery({
    queryKey: announcementKey,
    initialPageParam: 1,
    getNextPageParam: (last: AnnouncementListPayload) => last.meta.has_next_page ? last.meta.page + 1 : undefined,
    queryFn: ({ pageParam }): Promise<AnnouncementListPayload> => {
      const items = demoAnnouncements.filter((item) => !focusedCohortId || item.cohort_id === focusedCohortId || (!(managing && isStaff) && item.audience === 'global'));
      return auth.demo
        ? Promise.resolve({ announcements: items, unread_count: items.filter((item) => !item.read_at).length, meta: demoMeta(items.length) })
        : api.announcements({ ...(managing && isStaff ? { scope: 'manage' as const, sort: 'updated_desc' } : {}), ...(focusedCohortId ? { cohort_id: focusedCohortId } : {}), page: pageParam, per_page: 50 });
    },
    enabled: Boolean(user),
    staleTime: auth.demo ? Infinity : UPDATES_STALE_TIME,
    meta: { persist: true },
  });
  const notificationQuery = useInfiniteQuery({
    queryKey: notificationKey,
    initialPageParam: 1,
    getNextPageParam: (last: NotificationListPayload) => last.meta.has_next_page ? last.meta.page + 1 : undefined,
    queryFn: ({ pageParam }): Promise<NotificationListPayload> => auth.demo
      ? Promise.resolve({ notifications: demoNotifications, unread_count: demoNotifications.filter((item) => !item.read_at).length, meta: demoMeta(demoNotifications.length) })
      : api.notifications({ page: pageParam, per_page: 50 }),
    enabled: Boolean(user),
    staleTime: auth.demo ? Infinity : UPDATES_STALE_TIME,
    meta: { persist: true },
  });
  const { data: announcementData, error: announcementError, isPending: announcementsPending, refetch: refetchAnnouncements } = announcementQuery;
  const { data: notificationData, error: notificationError, isPending: notificationsPending, refetch: refetchNotifications } = notificationQuery;
  const announcements = useMemo(() => uniqueUpdates(announcementData?.pages.map((page) => page.announcements) ?? []), [announcementData]);
  const notifications = useMemo(() => uniqueUpdates(notificationData?.pages.map((page) => page.notifications) ?? []), [notificationData]);
  const unread = notificationData?.pages[0]?.unread_count ?? 0;

  useUpdatesFocusRefresh(userId, auth.demo);

  const invalidateUpdates = useCallback(() => {
    if (auth.demo) return;
    void queryClient.invalidateQueries({ queryKey: updatesKeys.root(userId) });
    void queryClient.invalidateQueries({ queryKey: learningKeys.dashboards(userId) });
  }, [auth.demo, queryClient, userId]);

  const setAnnouncementCaches = useCallback((announcement: Announcement, operation: 'read' | 'upsert') => {
    if (operation === 'read') {
      queryClient.setQueriesData<PagedUpdates<AnnouncementListPayload>>({ queryKey: updatesKeys.announcementLists(userId) }, (current) => readAnnouncementPages(current, announcement));
      queryClient.setQueryData<PagedUpdates<NotificationListPayload>>(notificationKey, (current) => readAnnouncementNotificationPages(current, announcement));
    } else {
      queryClient.getQueriesData<PagedUpdates<AnnouncementListPayload>>({ queryKey: updatesKeys.announcementLists(userId) }).forEach(([key]) => {
        const managingCache = key[4] === 'manage';
        const cohortId = key[5];
        if (typeof cohortId === 'number' && announcement.cohort_id !== cohortId && (managingCache || announcement.audience !== 'global')) return;
        queryClient.setQueryData<PagedUpdates<AnnouncementListPayload>>(key, (current) => current && {
          ...current, pages: current.pages.map((page, index) => index === 0 ? upsertAnnouncement(page, announcement, managingCache)! : { ...page, announcements: page.announcements.filter((item) => item.id !== announcement.id) }),
        });
      });
    }
    // Refetch also covers records outside the loaded pages and all cohort scopes.
    invalidateUpdates();
  }, [invalidateUpdates, notificationKey, queryClient, userId]);

  useEffect(() => {
    if (!userId || !announcement_id || !/^[1-9]\d*$/.test(announcement_id)) return;
    let canceled = false;
    const open = async () => {
      try {
        const result = auth.demo ? { announcement: demoAnnouncements.find((item) => item.id === Number(announcement_id)) } : await api.announcement(Number(announcement_id));
        if (canceled) return;
        if (!result.announcement) throw new Error('This update is unavailable.');
        setSelectedAnnouncement(result.announcement);
        setAnnouncementCaches(result.announcement, 'read');
        setSection('announcements');
        router.setParams({ announcement_id: undefined });
      } catch (error) {
        if (!canceled) { Alert.alert('Could not open update', (error as Error).message); router.setParams({ announcement_id: undefined }); }
      }
    };
    void open();
    return () => { canceled = true; };
  }, [announcement_id, api, auth.demo, router, setAnnouncementCaches, userId]);

  const refresh = async () => {
    setRefreshing(true);
    try { await Promise.all([refetchAnnouncements(), refetchNotifications()]); }
    finally { setRefreshing(false); }
  };

  // Staff who manage a posted update see its read counts, which only the detail carries (L-5.1).
  // Fetched quietly for an update that isn't unread for them; opening an unread one marks it read below.
  const loadReadCounts = async (item: Announcement) => {
    if (!user?.is_staff || item.status === 'draft' || auth.demo || item.unread) return;
    try {
      const fresh = (await api.announcement(item.id))?.announcement;
      if (fresh) setSelectedAnnouncement((current) => current?.id === item.id ? fresh : current);
    } catch { /* the list's copy stays open without counts */ }
  };

  const openAnnouncement = async (item: Announcement) => {
    setSelectedAnnouncement(item);
    if (item.read_at) {
      await loadReadCounts(item);
      return;
    }
    if (!item.read_at) {
      if (auth.demo) {
        const read = { ...item, read_at: new Date().toISOString(), unread: false };
        setSelectedAnnouncement(read);
        setAnnouncementCaches(read, 'read');
      } else {
        try { const result = await api.announcement(item.id); setSelectedAnnouncement(result.announcement); setAnnouncementCaches(result.announcement, 'read'); } catch (requestError) { Alert.alert('Could not mark update as read', (requestError as Error).message); }
      }
    }
  };

  const openNotification = async (item: AppNotification) => {
    if (!item.read_at) {
      if (auth.demo) {
        const read = { ...item, read_at: new Date().toISOString() };
        queryClient.setQueryData<PagedUpdates<NotificationListPayload>>(notificationKey, (current) => mapUpdatePages(current, (page) => readNotification(page, read, Math.max(0, (current?.pages[0]?.unread_count ?? 1) - 1))));
      } else {
        try { const result = await api.markNotificationRead(item.id); queryClient.setQueryData<PagedUpdates<NotificationListPayload>>(notificationKey, (current) => mapUpdatePages(current, (page) => readNotification(page, result.notification, result.unread_count))); invalidateUpdates(); } catch { /* navigation remains useful offline */ }
      }
    }
    if (item.target_available === false) { Alert.alert('Item unavailable', 'This item is no longer available.'); return; }
    if (item.notification_type === 'announcement' || item.notifiable.type === 'Announcement') {
      try {
        const cached = announcements.find((announcement) => announcement.id === item.notifiable.id);
        const result = auth.demo ? cached && { announcement: { ...cached, read_at: cached.read_at || new Date().toISOString() } } : await api.announcement(item.notifiable.id);
        if (result) { setSelectedAnnouncement(result.announcement); setAnnouncementCaches(result.announcement, 'read'); }
        setSection('announcements');
      } catch (requestError) { Alert.alert('Could not open update', (requestError as Error).message); }
      return;
    }
    const path = mobileNotificationPath(item.destination, item.notifiable.type === 'Message' ? item.notifiable.id : undefined, item.destination_path ?? item.path);
    router.push(path as Href);

  };

  const removeAnnouncement = async () => {
    if (!selectedAnnouncement) return;
    const item = selectedAnnouncement;
    if (item.status === 'draft') {
      const confirmed = await new Promise<boolean>((resolve) => Alert.alert('Delete draft?', `“${item.title}” was never posted. Deleting it can’t be undone.`, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Delete draft', style: 'destructive', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) }));
      if (!confirmed) return;
    }
    try {
      const result = await api.archiveAnnouncement(item.id);
      if (result.announcement.status === 'draft') {
        queryClient.setQueriesData<PagedUpdates<AnnouncementListPayload>>({ queryKey: updatesKeys.announcementLists(userId) }, (current) => mapUpdatePages(current, (page) => ({ ...page, announcements: page.announcements.filter((entry) => entry.id !== result.announcement.id) })));
        invalidateUpdates();
      } else setAnnouncementCaches(result.announcement, 'upsert');
      setSelectedAnnouncement(null);
    } catch (requestError) { Alert.alert('Could not archive update', (requestError as Error).message); }
  };

  const saveAnnouncement = async (data: EditorData) => {
    let result;
    if (selectedAnnouncement) {
      result = await api.updateAnnouncement(selectedAnnouncement.id, data);
    } else {
      result = await api.createAnnouncement({ ...data, audience: data.audience ?? 'cohort', client_request_id: createRequestId.current ??= generateRequestId() });
      const saved = result.announcement;
      if (Object.entries(data).some(([key, value]) => key !== 'send_push' && saved[key as keyof Announcement] !== value)) {
        // The POST may replay an earlier save whose response was lost.
        // Keep its id until PATCH succeeds; never clear unsaved words.
        result = await api.updateAnnouncement(saved.id, data);
      }
    }
    setAnnouncementCaches(result.announcement, 'upsert');
    // If typing continued during the save, keep the editor open on this
    // record so its next save is PATCH rather than another create.
    setSelectedAnnouncement(result.announcement);
    createRequestId.current = null;
  };

  const markAllRead = async () => {
    const now = new Date().toISOString();
    try {
      if (!auth.demo) await api.markAllNotificationsRead();
      queryClient.setQueryData<PagedUpdates<NotificationListPayload>>(notificationKey, (current) => mapUpdatePages(current, (page) => readAllNotifications(page, now)));
      queryClient.setQueriesData<PagedUpdates<AnnouncementListPayload>>({ queryKey: updatesKeys.announcementLists(userId) }, (current) => mapUpdatePages(current, (page) => readAllAnnouncements(page, now)));
      if (selectedAnnouncement) setSelectedAnnouncement({ ...selectedAnnouncement, read_at: selectedAnnouncement.read_at || now, unread: false });
      invalidateUpdates();
      if (!auth.demo) void queryClient.invalidateQueries({ queryKey: messagingKeys.inbox(userId) });
    } catch (requestError) { Alert.alert('Could not mark notifications read', (requestError as Error).message); }
  };

  const paging = section === 'announcements' ? announcementQuery : notificationQuery;
  const footer = <View>
    {!!paging.error && <ErrorState message={paging.error.message} retry={() => void (paging.isFetchNextPageError ? paging.fetchNextPage() : paging.refetch())} />}
    {paging.hasNextPage && <Button accessibilityLabel="Load earlier updates" disabled={paging.isFetching} onPress={() => void paging.fetchNextPage()}><Text style={styles.markAllText}>{paging.isFetchingNextPage ? 'Loading…' : 'Load earlier'}</Text></Button>}
  </View>;

  const blockingLoad = section === 'announcements' ? !announcementData && announcementsPending : !notificationData && notificationsPending;
  const blockingError = section === 'announcements' ? !announcementData && announcementError : !notificationData && notificationError;

  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><View><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.eyebrow}>WHAT MATTERS NOW</Text><Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.heading}>Updates</Text><Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.subhead}>{section === 'announcements' ? focusedCohortId ? managing && isStaff ? 'Manage updates for this cohort' : 'This cohort and school-wide updates' : unreadUpdatesLabel(announcementData?.pages[0]?.unread_count ?? 0) : unread ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'You’re all caught up'}</Text></View>{user?.is_staff && section === 'announcements' && <Pressable accessibilityRole="button" accessibilityLabel="Post update" onPress={() => setShowEditor(true)} style={styles.compose}><PenLine color={c.text.strong} size={20} /></Pressable>}</View>
    <View style={styles.tabs}><SectionButton active={section === 'announcements'} label="Updates" icon={Megaphone} onPress={() => { if (section !== 'announcements') haptic('selection'); setSection('announcements'); }} /><SectionButton active={section === 'inbox'} label="Notifications" icon={Inbox} badge={unread} onPress={() => { if (section !== 'inbox') haptic('selection'); setSection('inbox'); }} /></View>
    {user?.is_staff && section === 'announcements' && <View style={styles.manageRow}><Text style={styles.manageLabel}>Include drafts and archived</Text><View style={styles.switchSlot}><Switch accessibilityLabel="Include drafts and archived updates" value={managing} onValueChange={setManaging} {...switchColors(c, managing)} style={styles.switch} /></View></View>}
    {blockingLoad ? <LoadingState label="Loading updates" /> : blockingError ? <ErrorState message={blockingError.message} retry={() => void (section === 'announcements' ? refetchAnnouncements() : refetchNotifications())} /> : section === 'announcements' ? (
      <FlatList ListFooterComponent={footer} data={announcements} keyExtractor={(item) => String(item.id)} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={c.text.body} />} contentContainerStyle={styles.content} ListEmptyComponent={<Empty copy={managing ? 'No updates match this view.' : 'Updates from your instructors will appear here.'} />} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Open update: ${item.title}`} onPress={() => void openAnnouncement(item)} onLongPress={() => { if (user?.is_staff) { setSelectedAnnouncement(item); void loadReadCounts(item); } }} style={[styles.card, (item.unread ?? !item.read_at) && item.status === 'published' && styles.unreadCard]}><View style={styles.meta}><View style={styles.icon}>{item.pinned ? <Pin color={c.text.body} size={15} /> : <Bell color={c.text.body} size={15} />}</View><Text style={styles.scope}>{item.audience === 'global' ? 'School-wide' : item.cohort_name || 'Staff'}</Text>{item.status !== 'published' && <Text style={styles.statusPill}>{isScheduledUpdate(item) ? 'Scheduled' : humanize(item.status)}</Text>}{(item.unread ?? !item.read_at) && item.status === 'published' && <View style={styles.dot} />}</View><Text style={styles.title}>{item.title}</Text><Text numberOfLines={2} style={styles.body}>{markdownExcerpt(item.body)}</Text><View style={styles.cardFooter}><Text style={styles.byline}>{item.author?.full_name || `${brand.schoolName}`} · {updateWhen(item)}{item.edited_at ? ` · ${editedLabel(item.edited_at)}` : ''}</Text><ChevronRight color={c.text.muted} size={16} /></View></Pressable>} />
    ) : (
      <FlatList ListFooterComponent={footer} data={notifications} keyExtractor={(item) => String(item.id)} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={c.text.body} />} contentContainerStyle={styles.content} ListHeaderComponent={unread ? <Pressable accessibilityRole="button" onPress={() => void markAllRead()} style={styles.markAll}><CheckCheck color={c.text.body} size={17} /><Text style={styles.markAllText}>Mark everything read</Text></Pressable> : null} ListEmptyComponent={<Empty copy="Messages, mentions, submissions, and updates will appear here." />} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.read_at ? '' : 'Unread. '}${notificationTitle(item)}. ${markdownExcerpt(item.body)}`} onPress={() => void openNotification(item)} style={[styles.notification, !item.read_at && styles.notificationUnread]}><View style={[styles.notificationIcon, !item.read_at && styles.notificationIconUnread]}>{item.notifiable.type === 'Submission' ? <FileCheck2 color={c.text.body} size={18} /> : item.notifiable.type === 'Message' ? <MessageCircle color={c.text.body} size={18} /> : item.notification_type === 'announcement' ? <Megaphone color={c.text.body} size={18} /> : <Bell color={c.text.body} size={18} />}</View><View style={styles.notificationCopy}><Text numberOfLines={2} style={styles.notificationTitle}>{notificationTitle(item)}</Text>{!!item.body && <Text numberOfLines={3} style={styles.notificationBody}>{markdownExcerpt(item.body)}</Text>}<Text style={styles.notificationTime}>{formatRelative(item.created_at)} · {formatCourseDateTime(item.created_at, { fallback: '' })}</Text></View>{!item.read_at && <View style={styles.dot} />}</Pressable>} />
    )}

    <AnnouncementDetail item={showEditor ? null : selectedAnnouncement} canEdit={Boolean(user?.is_staff && selectedAnnouncement?.can_edit)} canArchive={Boolean(user?.is_staff && (selectedAnnouncement?.status === 'draft' ? (selectedAnnouncement?.can_edit || (selectedAnnouncement?.schedule_failure && selectedAnnouncement.author?.id === user?.id)) : selectedAnnouncement?.can_archive))} onClose={() => setSelectedAnnouncement(null)} onEdit={() => setShowEditor(true)} onArchive={() => void removeAnnouncement()} />
    <AnnouncementEditor visible={showEditor} initial={selectedAnnouncement} defaultCohortId={focusedCohortId} workspaces={workspaces} onClose={() => { setShowEditor(false); setSelectedAnnouncement(null); createRequestId.current = null; }} onSave={saveAnnouncement} />
  </SafeAreaView>;
}

function SectionButton({ active, label, icon: Icon, badge = 0, onPress }: { active: boolean; label: string; icon: typeof Inbox; badge?: number; onPress: () => void }) {
  const styles = useStyles();
  const { colors: c } = useTheme(); return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.tab, active && styles.tabActive]}><Icon color={active ? c.text.strong : c.text.body} size={16} /><Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>{badge > 0 && <Text style={styles.badge}>{badge > 99 ? '99+' : badge}</Text>}</Pressable>; }
function Empty({ copy }: { copy: string }) {
  const styles = useStyles(); return <View style={styles.empty}><Text style={styles.emptyTitle}>You’re all caught up</Text><Text style={styles.emptyCopy}>{copy}</Text></View>; }

// Edit (and deleting a draft) is for the author or an admin; archiving a posted update is for any staff on its audience (can_archive).
function AnnouncementDetail({ item, canEdit, canArchive, onClose, onEdit, onArchive }: { item: Announcement | null; canEdit: boolean; canArchive: boolean; onClose: () => void; onEdit: () => void; onArchive: () => void }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  return <Modal visible={Boolean(item)} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalRoot}><Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} /><View style={styles.sheet}><View style={styles.sheetHandle} />{item && <ScrollView contentContainerStyle={styles.detail}><View style={styles.detailTop}><View style={styles.detailIcon}><Megaphone color={c.text.body} size={20} /></View><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}><X color={c.text.body} size={20} /></Pressable></View><Text style={styles.detailScope}>{item.audience === 'global' ? 'School-wide' : item.cohort_name || 'Staff'} · {updateWhen(item)}</Text>{isScheduledUpdate(item) ? <Text testID="announcement-scheduled" style={styles.detailScope}>Scheduled updates go out with the hourly run. Only you and admins see it until then.</Text> : null}{item.read_summary && item.read_summary.notified > 0 ? <Text testID="announcement-read-summary" style={styles.detailScope}>{`${item.read_summary.read} of ${item.read_summary.notified} ${item.read_summary.notified === 1 ? 'person it went to has' : 'people it went to have'} read it`}</Text> : null}<Text style={styles.detailTitle}>{item.title}</Text>{item.edited_at ? <Text testID="announcement-edited" style={styles.detailScope}>{editedLabel(item.edited_at)}</Text> : null}<View style={styles.detailBody}><FormattedMessage body={item.body} mentionUsers={[]} /></View><Text style={styles.detailAuthor}>Shared by {item.author?.full_name || `${brand.schoolName}`}</Text>{(canEdit || canArchive) && <View style={styles.detailActions}>{canEdit && <Pressable accessibilityRole="button" onPress={onEdit} style={styles.secondaryButton}><PenLine color={c.text.strong} size={17} /><Text style={styles.secondaryText}>Edit</Text></Pressable>}{canArchive && item.status !== 'archived' && <Pressable accessibilityRole="button" onPress={onArchive} style={styles.archiveButton}><Archive color={c.text.body} size={17} /><Text style={styles.archiveText}>{item.status === 'draft' ? 'Delete draft' : 'Archive'}</Text></Pressable>}</View>}</ScrollView>}</View></View></Modal>;
}

type EditorData = Omit<components['schemas']['AnnouncementCreateRequest'], 'audience' | 'client_request_id'> & { audience?: Announcement['audience'] };
function AnnouncementEditor({ visible, initial, defaultCohortId, workspaces, onClose, onSave }: { visible: boolean; initial: Announcement | null; defaultCohortId: number | null; workspaces: { cohort_id: number | null; cohort_name: string | null; name: string }[]; onClose: () => void; onSave: (data: EditorData) => Promise<void> }) {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const bodyInput = useRef<TextInput>(null);
  const revision = useRef(0);
  const savingRef = useRef(false);
  const change = <T,>(setter: (value: T) => void) => (value: T) => { revision.current += 1; setter(value); };
  const close = () => { if (!savingRef.current) onClose(); };
  const [bodySelection, setBodySelection] = useState({ start: 0, end: 0 });
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [audience, setAudience] = useState<Announcement['audience']>('cohort'); const [cohortId, setCohortId] = useState<number | null>(null); const [pinned, setPinned] = useState(false); const [publish, setPublish] = useState(true); const [push, setPush] = useState(true); const [saving, setSaving] = useState(false);
  const cohorts = useMemo(() => Array.from(new Map(workspaces.filter((workspace) => workspace.cohort_id).map((workspace) => [workspace.cohort_id!, { id: workspace.cohort_id!, name: workspace.cohort_name || workspace.name }])).values()), [workspaces]);
  const audienceCohort = cohorts.find((cohort) => cohort.id === cohortId) || null;
  const contextCohort = cohorts.find((cohort) => cohort.id === defaultCohortId) || null;
  const audienceLabel = audience === 'global' ? 'Everyone' : audience === 'staff' ? 'Staff only' : audienceCohort?.name || null;
  // Anything that would newly reach people (a new post, or a draft being published) skips the check only when it
  // goes to the cohort the poster is viewing. Editing an already-published announcement asks when its audience moves.
  // A posted (or archived) update keeps its audience; only its words and pin change, and nobody is notified again (U-3.6).
  const posted = Boolean(initial && initial.status !== 'draft');
  const publishing = publish && (!initial || initial.status === 'draft');
  const toContextCohort = audience === 'cohort' && audienceCohort !== null && audienceCohort.id === contextCohort?.id;
  const confirmAudience = () => {
    const showAlert = (title: string, message: string, action: string) => new Promise<boolean>((resolve) => Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: action, onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));
    if (publishing && !toContextCohort) return showAlert(audience === 'global' ? 'Post to everyone?' : audience === 'staff' ? 'Post to staff only?' : `Post to ${audienceLabel}?`, audience === 'global' ? 'This goes to every student and staff member in the school, not just one class.' : audience === 'staff' ? 'Students will not see this update.' : `${contextCohort ? `You are viewing ${contextCohort.name}, but this` : 'This'} will go to ${audienceLabel}.`, 'Post');
    return Promise.resolve(true);
  };
  const reset = useCallback(() => { setTitle(initial?.title || ''); setBody(initial?.body || ''); setAudience(initial?.audience || 'cohort'); setCohortId(initial?.cohort_id || (defaultCohortId && cohorts.some((cohort) => cohort.id === defaultCohortId) ? defaultCohortId : null)); setPinned(initial?.pinned || false); setPublish(initial ? initial.status === 'published' : true); setPush(!initial || initial.status === 'draft'); }, [cohorts, defaultCohortId, initial]);
  return <Modal visible={visible} animationType="fade" presentationStyle="pageSheet" onShow={reset} onRequestClose={close}><SafeAreaView style={styles.editorSafe}><View style={styles.editorHeader}><Pressable accessibilityRole="button" accessibilityLabel="Close update editor" disabled={saving} onPress={close} style={styles.close}><X color={c.text.body} size={20} /></Pressable><Text style={styles.editorTitle}>{posted ? 'Edit update' : initial ? 'Edit draft' : 'New update'}</Text><Button variant="primary" accessibilityRole="button" disabled={saving || !title.trim() || (!body.trim() && (posted || publish)) || (!posted && audience === 'cohort' && !cohortId)} onPress={async () => { if (savingRef.current) return; savingRef.current = true; const submittedRevision = revision.current; try { if (!(await confirmAudience())) return; setSaving(true); await onSave(posted ? { title: title.trim(), body: messageBodyForSend(body), pinned } : { title: title.trim(), body: messageBodyForSend(body), audience, cohort_id: audience === 'cohort' ? cohortId : null, status: publish ? 'published' : 'draft', pinned, send_push: publish && push }); if (revision.current === submittedRevision) onClose(); } catch (requestError) { Alert.alert('Could not save update', (requestError as Error).message); } finally { savingRef.current = false; setSaving(false); } }} style={styles.saveButton}><Send color={c.text.strong} size={15} /><Text style={styles.saveText}>{saving ? 'Saving' : 'Save'}</Text></Button></View><Text accessibilityLiveRegion="polite" style={[styles.audienceBar, !posted && !audienceLabel && styles.audienceBarMissing]}>{posted ? `Posted to ${audienceLabel || 'its audience'}. Who sees an update can’t change after it’s posted; post a new update to reach other people. Saving doesn’t notify anyone again.` : audienceLabel ? `Posting to: ${audienceLabel}` : 'Choose a cohort to post to'}</Text><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editorContent}><Text style={styles.fieldLabel}>TITLE</Text><TextInput keyboardAppearance={scheme} accessibilityLabel="Update title" value={title} onChangeText={change(setTitle)} placeholder="What should everyone know?" placeholderTextColor={c.text.body} style={styles.field} /><Text style={styles.fieldLabel}>MESSAGE</Text><TextInput keyboardAppearance={scheme} ref={bodyInput} accessibilityLabel="Update message" accessibilityHint="Markdown: plain text with Preview" autoCorrect={false} autoCapitalize="none" spellCheck={false} smartInsertDelete={false} selection={bodySelection} onSelectionChange={(event) => setBodySelection(event.nativeEvent.selection)} value={body} onChangeText={change(setBody)} placeholder="Share the details clearly…" placeholderTextColor={c.text.body} multiline style={[styles.field, styles.bodyField]} /><MessageFormattingToolbar value={body} selection={bodySelection} visible onChange={change(setBody)} onSelectionChange={setBodySelection} onComposerFocus={() => bodyInput.current?.focus()} onLimitExceeded={() => Alert.alert("Draft is too long")} />{!posted && <><Text style={styles.fieldLabel}>AUDIENCE</Text><View style={styles.choiceRow}>{(['cohort', 'global', 'staff'] as const).map((value) => <Pressable key={value} accessibilityRole="radio" disabled={saving} accessibilityState={{ checked: audience === value }} onPress={() => change(setAudience)(value)} style={[styles.choice, audience === value && styles.choiceActive]}><Text style={[styles.choiceText, audience === value && styles.choiceTextActive]}>{value}</Text></Pressable>)}</View>{audience === 'cohort' && <><Text style={styles.fieldLabel}>COHORT</Text><View style={styles.cohortList}>{cohorts.map((cohort) => <Pressable key={cohort.id} accessibilityRole="radio" disabled={saving} accessibilityState={{ checked: cohortId === cohort.id }} onPress={() => change(setCohortId)(cohort.id)} style={[styles.cohortChoice, cohortId === cohort.id && styles.choiceActive]}><Users color={cohortId === cohort.id ? c.selection.indicator : c.text.body} size={15} /><Text style={[styles.choiceText, cohortId === cohort.id && styles.choiceTextActive]}>{cohort.name}</Text></Pressable>)}</View></>}</>}<EditorToggle label="Pin to the top" value={pinned} onValueChange={change(setPinned)} />{!posted && <><EditorToggle label="Post now" disabled={saving} value={publish} onValueChange={change(setPublish)} /><EditorToggle label="Send a push notification" value={push} onValueChange={change(setPush)} disabled={saving || !publish} /></>}</ScrollView></SafeAreaView></Modal>;
}
function EditorToggle({ label, value, onValueChange, disabled = false }: { label: string; value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean }) {
  const styles = useStyles();
  const { colors: c } = useTheme(); return <View style={[styles.editorToggle, disabled && { opacity: 0.45 }]}><Text style={styles.editorToggleText}>{label}</Text><View style={styles.switchSlot}><Switch accessibilityLabel={label} disabled={disabled} value={value} onValueChange={onValueChange} {...switchColors(c, value)} style={styles.switch} /></View></View>; }
function unreadUpdatesLabel(count: number) { return count > 0 ? `${count} unread ${count === 1 ? 'update' : 'updates'}` : 'You’re all caught up'; }
function editedLabel(value: string) { return `Edited ${formatCourseDateTime(value, { withYear: true, fallback: 'recently' })}`; }
/** When it went out, or for a scheduled draft when it will (U-3.6). */
function updateWhen(item: Announcement) {
  if (item.status === 'draft' && item.schedule_failure) return item.schedule_failure; return isScheduledUpdate(item) ? sendsAboutLabel(item.scheduled_for!) : formatDate(item.published_at || item.updated_at); }
function formatDate(value: string | null) { return value ? formatCourseDate(value, { withYear: true, fallback: 'Recently' }) : 'Recently'; }
function formatRelative(value: string) { const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000)); if (minutes < 1) return 'Now'; if (minutes < 60) return `${minutes}m ago`; if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`; return formatDate(value); }

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, eyebrow: { ...typography.label, color: c.text.body, fontFamily: fonts.bold, letterSpacing: 1.8 }, heading: { ...typography.display, color: c.text.strong, fontFamily: fonts.extraBold, letterSpacing: -1.2 }, subhead: { ...typography.support, color: c.text.body, fontFamily: fonts.regular, marginTop: 4 }, compose: { width: 48, height: 48, borderRadius: 16, backgroundColor: c.selection.bg, alignItems: 'center', justifyContent: 'center' },
  tabs: { marginHorizontal: 20, padding: 4, borderRadius: 16, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, flexDirection: 'row', gap: 4 }, tab: { flex: 1, minHeight: 44, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, tabActive: { backgroundColor: c.selection.bg, borderColor: c.selection.indicator, borderWidth: 2 }, tabText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, tabTextActive: { color: c.text.strong }, badge: { minWidth: 19, height: 19, borderRadius: 10, overflow: 'hidden', backgroundColor: c.selection.bg, color: c.text.strong, fontFamily: fonts.bold, fontSize: 12, lineHeight: 19, textAlign: 'center', paddingHorizontal: 4 }, manageRow: { minHeight: 48, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, manageLabel: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32, gap: 12, flexGrow: 1 }, card: { padding: 14, borderRadius: 16, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle }, unreadCard: { borderColor: c.border.strong, backgroundColor: c.surface.sunken }, meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }, icon: { width: 28, height: 28, borderRadius: 10, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, scope: { flex: 1, color: c.text.body, fontFamily: fonts.bold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8 }, statusPill: { color: c.status.warning.fg, backgroundColor: c.surface.sunken, borderRadius: 9, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4, fontFamily: fonts.bold, fontSize: 12, textTransform: 'uppercase' }, dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.text.body }, title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 }, body: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, marginTop: 9 }, cardFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 10 }, byline: { flex: 1, color: c.text.body, fontFamily: fonts.medium, fontSize: 12 },
  markAll: { minHeight: 44, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 7 }, markAllText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, notification: { minHeight: 96, borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, notificationUnread: { borderColor: c.border.strong, backgroundColor: c.surface.sunken }, notificationIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, notificationIconUnread: { backgroundColor: c.surface.sunken }, notificationCopy: { flex: 1 }, notificationTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 }, notificationBody: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, marginTop: 4 }, notificationTime: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12, marginTop: 8 },
  empty: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 38 }, emptyTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17 }, emptyCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay }, sheet: { maxHeight: '86%', backgroundColor: c.surface.raised, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: c.border.subtle }, sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: c.border.subtle, alignSelf: 'center', marginTop: 10 }, detail: { padding: 22, paddingTop: 16, paddingBottom: 36 }, detailTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, detailIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, detailScope: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 20 }, detailTitle: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 27, lineHeight: 34, letterSpacing: -0.6, marginTop: 7 }, detailBody: { marginTop: 18 }, detailAuthor: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12, marginTop: 24 }, detailActions: { flexDirection: 'row', gap: 9, marginTop: 26 }, secondaryButton: { flex: 1, minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, secondaryText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, archiveButton: { flex: 1, minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, archiveText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  editorSafe: { flex: 1, backgroundColor: c.surface.page }, editorHeader: { minHeight: 64, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, audienceBar: { paddingHorizontal: 20, paddingVertical: 10, color: c.text.strong, fontFamily: fonts.semibold, fontSize: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle }, audienceBarMissing: { color: c.status.danger.fg }, editorTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17 }, saveButton: { minWidth: 76, minHeight: 44, borderRadius: 13,  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, saveText: { color: c.text.onAction, fontFamily: fonts.bold, fontSize: 12 }, editorContent: { padding: 20, paddingBottom: 50 }, fieldLabel: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.3, marginTop: 18, marginBottom: 7 }, field: { minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, color: c.text.strong, fontFamily: fonts.regular, fontSize: 14, paddingHorizontal: 14 }, bodyField: { fontSize: 16, minHeight: 170, textAlignVertical: 'top', paddingTop: 14 }, choiceRow: { flexDirection: 'row', gap: 7 }, choice: { flex: 1, minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, alignItems: 'center', justifyContent: 'center' }, choiceActive: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg, borderWidth: 2 }, choiceText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, textTransform: 'capitalize' }, choiceTextActive: { color: c.text.strong, fontFamily: fonts.extraBold }, cohortList: { gap: 7 }, cohortChoice: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 }, editorToggle: { minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, editorToggleText: { flex: 1, color: c.text.strong, fontFamily: fonts.semibold, fontSize: 13 }, switchSlot: { width: 54, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, switch: { transform: [{ scaleX: 0.88 }, { scaleY: 0.88 }] },
}));
