import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Archive, Bell, CheckCheck, ChevronRight, FileCheck2, Inbox, Megaphone, MessageCircle, PenLine, Pin, Send, Users, X } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/screen-states';
import { fontScaleLimits, fonts, palette, typography } from '@/constants/csg-theme';
import { demoAnnouncements, demoNotifications } from '@/lib/demo-data';
import { mobileNotificationPath } from '@/lib/notification-path';
import type { Announcement, AppNotification, PaginationMeta } from '@/lib/types';
import { readAllNotifications, readAnnouncement, readAnnouncementNotification, readNotification, updatesKeys, upsertAnnouncement, type AnnouncementListPayload, type NotificationListPayload } from '@/lib/updates-cache';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useWorkspace } from '@/providers/workspace-provider';

type Section = 'announcements' | 'inbox';

function demoMeta(totalCount: number): PaginationMeta {
  return { page: 1, per_page: 50, total_count: totalCount, total_pages: totalCount ? 1 : 0, has_next_page: false, has_prev_page: false };
}

export default function UpdatesScreen() {
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const isStaff = Boolean(user?.is_staff);
  const { workspaces } = useWorkspace();
  const queryClient = useQueryClient();
  const userId = user?.id ?? 0;
  const [section, setSection] = useState<Section>('announcements');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [managing, setManaging] = useState(false);
  const announcementKey = useMemo(() => updatesKeys.announcements(userId, managing && isStaff), [isStaff, managing, userId]);
  const notificationKey = useMemo(() => updatesKeys.notifications(userId), [userId]);
  const announcementQuery = useQuery({
    queryKey: announcementKey,
    queryFn: (): Promise<AnnouncementListPayload> => auth.demo
      ? Promise.resolve({ announcements: demoAnnouncements, unread_count: demoAnnouncements.filter((item) => !item.read_at).length, meta: demoMeta(demoAnnouncements.length) })
      : api.announcements({ ...(managing && isStaff ? { scope: 'manage' as const, sort: 'updated_desc' } : {}), per_page: 50 }),
    enabled: Boolean(user),
    staleTime: auth.demo ? Infinity : undefined,
    meta: { persist: true },
  });
  const notificationQuery = useQuery({
    queryKey: notificationKey,
    queryFn: (): Promise<NotificationListPayload> => auth.demo
      ? Promise.resolve({ notifications: demoNotifications, unread_count: demoNotifications.filter((item) => !item.read_at).length, meta: demoMeta(demoNotifications.length) })
      : api.notifications({ per_page: 50 }),
    enabled: Boolean(user),
    staleTime: auth.demo ? Infinity : undefined,
    meta: { persist: true },
  });
  const { data: announcementData, error: announcementError, isFetching: announcementsFetching, isPending: announcementsPending, isStale: announcementsStale, refetch: refetchAnnouncements } = announcementQuery;
  const { data: notificationData, error: notificationError, isFetching: notificationsFetching, isPending: notificationsPending, isStale: notificationsStale, refetch: refetchNotifications } = notificationQuery;
  const announcements = useMemo(() => announcementData?.announcements ?? [], [announcementData?.announcements]);
  const notifications = useMemo(() => notificationData?.notifications ?? [], [notificationData?.notifications]);
  const unread = notificationData?.unread_count ?? announcementData?.unread_count ?? 0;

  useFocusEffect(useCallback(() => {
    if (announcementData && announcementsStale && !announcementsFetching) void refetchAnnouncements();
    if (notificationData && notificationsStale && !notificationsFetching) void refetchNotifications();
  }, [announcementData, announcementsFetching, announcementsStale, notificationData, notificationsFetching, notificationsStale, refetchAnnouncements, refetchNotifications]));

  const setAnnouncementCaches = useCallback((announcement: Announcement, operation: 'read' | 'upsert') => {
    ([false, true] as const).forEach((managingCache) => {
      queryClient.setQueryData<AnnouncementListPayload>(updatesKeys.announcements(userId, managingCache), (current) => (
        operation === 'read' ? readAnnouncement(current, announcement) : upsertAnnouncement(current, announcement, managingCache)
      ));
    });
    if (operation === 'read') {
      queryClient.setQueryData<NotificationListPayload>(notificationKey, (current) => readAnnouncementNotification(current, announcement.id, announcement.read_at));
    }
  }, [notificationKey, queryClient, userId]);

  const refresh = async () => {
    setRefreshing(true);
    try { await Promise.all([refetchAnnouncements(), refetchNotifications()]); }
    finally { setRefreshing(false); }
  };

  const openAnnouncement = async (item: Announcement) => {
    setSelectedAnnouncement(item);
    if (!item.read_at) {
      if (auth.demo) {
        const read = { ...item, read_at: new Date().toISOString() };
        setSelectedAnnouncement(read);
        setAnnouncementCaches(read, 'read');
      } else {
        try { const result = await api.announcement(item.id); setSelectedAnnouncement(result.announcement); setAnnouncementCaches(result.announcement, 'read'); } catch { /* keep cached detail visible */ }
      }
    }
  };

  const openNotification = async (item: AppNotification) => {
    if (!item.read_at) {
      if (auth.demo) {
        const read = { ...item, read_at: new Date().toISOString() };
        queryClient.setQueryData<NotificationListPayload>(notificationKey, (current) => readNotification(current, read, Math.max(0, (current?.unread_count ?? 1) - 1)));
      } else {
        try { const result = await api.markNotificationRead(item.id); queryClient.setQueryData<NotificationListPayload>(notificationKey, (current) => readNotification(current, result.notification, result.unread_count)); } catch { /* navigation remains useful offline */ }
      }
    }
    if (item.notification_type === 'announcement' || item.notifiable.type === 'Announcement') {
      try {
        const cached = announcements.find((announcement) => announcement.id === item.notifiable.id);
        const result = auth.demo ? cached && { announcement: { ...cached, read_at: cached.read_at || new Date().toISOString() } } : await api.announcement(item.notifiable.id);
        if (result) { setSelectedAnnouncement(result.announcement); setAnnouncementCaches(result.announcement, 'read'); }
        setSection('announcements');
      } catch (requestError) { Alert.alert('Could not open announcement', (requestError as Error).message); }
      return;
    }
    const path = mobileNotificationPath(item.path);
    const anchoredPath = item.notifiable.type === 'Message' ? `${path}${path.includes('?') ? '&' : '?'}messageId=${item.notifiable.id}` : path;
    router.push(anchoredPath as Href);
  };

  const markAllRead = async () => {
    const now = new Date().toISOString();
    if (auth.demo) { queryClient.setQueryData<NotificationListPayload>(notificationKey, (current) => readAllNotifications(current, now)); return; }
    try { await api.markAllNotificationsRead(); queryClient.setQueryData<NotificationListPayload>(notificationKey, (current) => readAllNotifications(current, now)); }
    catch (requestError) { Alert.alert('Could not mark notifications read', (requestError as Error).message); }
  };

  const blockingLoad = section === 'announcements' ? !announcementData && announcementsPending : !notificationData && notificationsPending;
  const blockingError = section === 'announcements' ? !announcementData && announcementError : !notificationData && notificationError;

  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><View><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.eyebrow}>WHAT MATTERS NOW</Text><Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.heading}>Updates</Text><Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.subhead}>{unread ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'You’re all caught up'}</Text></View>{user?.is_staff && section === 'announcements' && <Pressable accessibilityRole="button" accessibilityLabel="Write an announcement" onPress={() => setShowEditor(true)} style={styles.compose}><PenLine color={palette.text} size={20} /></Pressable>}</View>
    <View style={styles.tabs}><SectionButton active={section === 'announcements'} label="Announcements" icon={Megaphone} onPress={() => setSection('announcements')} /><SectionButton active={section === 'inbox'} label="Inbox" icon={Inbox} badge={unread} onPress={() => setSection('inbox')} /></View>
    {user?.is_staff && section === 'announcements' && <View style={styles.manageRow}><Text style={styles.manageLabel}>Include drafts and archived</Text><View style={styles.switchSlot}><Switch accessibilityLabel="Include drafts and archived announcements" value={managing} onValueChange={setManaging} trackColor={{ false: palette.line, true: '#6A2A36' }} thumbColor={managing ? palette.rubySoft : palette.muted} style={styles.switch} /></View></View>}
    {blockingLoad ? <LoadingState label="Loading updates" /> : blockingError ? <ErrorState message={blockingError.message} retry={() => void (section === 'announcements' ? refetchAnnouncements() : refetchNotifications())} /> : section === 'announcements' ? (
      <FlatList data={announcements} keyExtractor={(item) => String(item.id)} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content} ListEmptyComponent={<Empty copy={managing ? 'No managed announcements match this view.' : 'Announcements from your instructors will appear here.'} />} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Open announcement: ${item.title}`} onPress={() => void openAnnouncement(item)} onLongPress={() => user?.is_staff && setSelectedAnnouncement(item)} style={[styles.card, !item.read_at && item.status === 'published' && styles.unreadCard]}><View style={styles.meta}><View style={styles.icon}>{item.pinned ? <Pin color={palette.rubySoft} size={15} /> : <Bell color={palette.muted} size={15} />}</View><Text style={styles.scope}>{item.cohort_name || item.audience}</Text>{item.status !== 'published' && <Text style={styles.statusPill}>{item.status}</Text>}{!item.read_at && item.status === 'published' && <View style={styles.dot} />}</View><Text style={styles.title}>{item.title}</Text><Text numberOfLines={4} style={styles.body}>{item.body}</Text><View style={styles.cardFooter}><Text style={styles.byline}>{item.author?.full_name || 'Code School of Guam'} · {formatDate(item.published_at || item.updated_at)}</Text><ChevronRight color={palette.quiet} size={16} /></View></Pressable>} />
    ) : (
      <FlatList data={notifications} keyExtractor={(item) => String(item.id)} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content} ListHeaderComponent={unread ? <Pressable accessibilityRole="button" onPress={() => void markAllRead()} style={styles.markAll}><CheckCheck color={palette.rubySoft} size={17} /><Text style={styles.markAllText}>Mark everything read</Text></Pressable> : null} ListEmptyComponent={<Empty copy="Messages, mentions, submissions, and announcements will appear here." />} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.read_at ? '' : 'Unread. '}${item.title}. ${item.body}`} onPress={() => void openNotification(item)} style={[styles.notification, !item.read_at && styles.notificationUnread]}><View style={[styles.notificationIcon, !item.read_at && styles.notificationIconUnread]}>{item.notifiable.type === 'Submission' ? <FileCheck2 color={palette.rubySoft} size={18} /> : item.notifiable.type === 'Message' ? <MessageCircle color={palette.rubySoft} size={18} /> : item.notification_type === 'announcement' ? <Megaphone color={palette.rubySoft} size={18} /> : <Bell color={palette.rubySoft} size={18} />}</View><View style={styles.notificationCopy}><Text numberOfLines={2} style={styles.notificationTitle}>{item.title}</Text><Text numberOfLines={3} style={styles.notificationBody}>{item.body}</Text><Text style={styles.notificationTime}>{formatRelative(item.created_at)}</Text></View>{!item.read_at && <View style={styles.dot} />}</Pressable>} />
    )}

    <AnnouncementDetail item={selectedAnnouncement} canManage={Boolean(user?.is_staff)} onClose={() => setSelectedAnnouncement(null)} onEdit={() => setShowEditor(true)} onArchive={async () => { if (!selectedAnnouncement) return; try { const result = await api.archiveAnnouncement(selectedAnnouncement.id); setAnnouncementCaches(result.announcement, 'upsert'); setSelectedAnnouncement(null); } catch (requestError) { Alert.alert('Could not archive announcement', (requestError as Error).message); } }} />
    <AnnouncementEditor visible={showEditor} initial={selectedAnnouncement} workspaces={workspaces} onClose={() => { setShowEditor(false); setSelectedAnnouncement(null); }} onSave={async (data) => { const result = selectedAnnouncement ? await api.updateAnnouncement(selectedAnnouncement.id, data) : await api.createAnnouncement(data); setAnnouncementCaches(result.announcement, 'upsert'); setShowEditor(false); setSelectedAnnouncement(null); }} />
  </SafeAreaView>;
}

function SectionButton({ active, label, icon: Icon, badge = 0, onPress }: { active: boolean; label: string; icon: typeof Inbox; badge?: number; onPress: () => void }) { return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.tab, active && styles.tabActive]}><Icon color={active ? palette.text : palette.muted} size={16} /><Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>{badge > 0 && <Text style={styles.badge}>{badge > 99 ? '99+' : badge}</Text>}</Pressable>; }
function Empty({ copy }: { copy: string }) { return <View style={styles.empty}><Text style={styles.emptyTitle}>Nothing new here</Text><Text style={styles.emptyCopy}>{copy}</Text></View>; }

function AnnouncementDetail({ item, canManage, onClose, onEdit, onArchive }: { item: Announcement | null; canManage: boolean; onClose: () => void; onEdit: () => void; onArchive: () => void }) {
  return <Modal visible={Boolean(item)} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalRoot}><Pressable style={StyleSheet.absoluteFill} onPress={onClose} /><View style={styles.sheet}><View style={styles.sheetHandle} />{item && <ScrollView contentContainerStyle={styles.detail}><View style={styles.detailTop}><View style={styles.detailIcon}><Megaphone color={palette.rubySoft} size={20} /></View><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}><X color={palette.muted} size={20} /></Pressable></View><Text style={styles.detailScope}>{item.cohort_name || item.audience} · {formatDate(item.published_at || item.updated_at)}</Text><Text style={styles.detailTitle}>{item.title}</Text><Text style={styles.detailBody}>{item.body}</Text><Text style={styles.detailAuthor}>Shared by {item.author?.full_name || 'Code School of Guam'}</Text>{canManage && <View style={styles.detailActions}><Pressable accessibilityRole="button" onPress={onEdit} style={styles.secondaryButton}><PenLine color={palette.text} size={17} /><Text style={styles.secondaryText}>Edit</Text></Pressable>{item.status !== 'archived' && <Pressable accessibilityRole="button" onPress={onArchive} style={styles.archiveButton}><Archive color={palette.rubySoft} size={17} /><Text style={styles.archiveText}>Archive</Text></Pressable>}</View>}</ScrollView>}</View></View></Modal>;
}

type EditorData = { title: string; body: string; audience: Announcement['audience']; cohort_id?: number | null; status: Announcement['status']; pinned: boolean; send_push?: boolean };
function AnnouncementEditor({ visible, initial, workspaces, onClose, onSave }: { visible: boolean; initial: Announcement | null; workspaces: { cohort_id: number | null; cohort_name: string | null; name: string }[]; onClose: () => void; onSave: (data: EditorData) => Promise<void> }) {
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [audience, setAudience] = useState<Announcement['audience']>('cohort'); const [cohortId, setCohortId] = useState<number | null>(null); const [pinned, setPinned] = useState(false); const [publish, setPublish] = useState(true); const [push, setPush] = useState(true); const [saving, setSaving] = useState(false);
  const cohorts = useMemo(() => Array.from(new Map(workspaces.filter((workspace) => workspace.cohort_id).map((workspace) => [workspace.cohort_id!, { id: workspace.cohort_id!, name: workspace.cohort_name || workspace.name }])).values()), [workspaces]);
  const reset = useCallback(() => { setTitle(initial?.title || ''); setBody(initial?.body || ''); setAudience(initial?.audience || 'cohort'); setCohortId(initial?.cohort_id || cohorts[0]?.id || null); setPinned(initial?.pinned || false); setPublish(initial ? initial.status === 'published' : true); setPush(!initial); }, [cohorts, initial]);
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onShow={reset} onRequestClose={onClose}><SafeAreaView style={styles.editorSafe}><View style={styles.editorHeader}><Pressable accessibilityRole="button" onPress={onClose} style={styles.close}><X color={palette.muted} size={20} /></Pressable><Text style={styles.editorTitle}>{initial ? 'Edit announcement' : 'New announcement'}</Text><Pressable accessibilityRole="button" disabled={saving || !title.trim() || !body.trim() || (audience === 'cohort' && !cohortId)} onPress={async () => { setSaving(true); try { await onSave({ title: title.trim(), body: body.trim(), audience, cohort_id: audience === 'cohort' ? cohortId : null, status: publish ? 'published' : 'draft', pinned, send_push: publish && push }); } catch (requestError) { Alert.alert('Could not save announcement', (requestError as Error).message); } finally { setSaving(false); } }} style={styles.saveButton}><Send color={palette.text} size={15} /><Text style={styles.saveText}>{saving ? 'Saving' : 'Save'}</Text></Pressable></View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editorContent}><Text style={styles.fieldLabel}>TITLE</Text><TextInput accessibilityLabel="Announcement title" value={title} onChangeText={setTitle} placeholder="What should everyone know?" placeholderTextColor={palette.quiet} style={styles.field} /><Text style={styles.fieldLabel}>MESSAGE</Text><TextInput accessibilityLabel="Announcement message" value={body} onChangeText={setBody} placeholder="Share the details clearly…" placeholderTextColor={palette.quiet} multiline style={[styles.field, styles.bodyField]} /><Text style={styles.fieldLabel}>AUDIENCE</Text><View style={styles.choiceRow}>{(['cohort', 'global', 'staff'] as const).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: audience === value }} onPress={() => setAudience(value)} style={[styles.choice, audience === value && styles.choiceActive]}><Text style={[styles.choiceText, audience === value && styles.choiceTextActive]}>{value}</Text></Pressable>)}</View>{audience === 'cohort' && <><Text style={styles.fieldLabel}>COHORT</Text><View style={styles.cohortList}>{cohorts.map((cohort) => <Pressable key={cohort.id} accessibilityRole="radio" accessibilityState={{ checked: cohortId === cohort.id }} onPress={() => setCohortId(cohort.id)} style={[styles.cohortChoice, cohortId === cohort.id && styles.choiceActive]}><Users color={cohortId === cohort.id ? palette.rubySoft : palette.muted} size={15} /><Text style={[styles.choiceText, cohortId === cohort.id && styles.choiceTextActive]}>{cohort.name}</Text></Pressable>)}</View></>}<EditorToggle label="Pin to the top" value={pinned} onValueChange={setPinned} /><EditorToggle label="Publish now" value={publish} onValueChange={setPublish} /><EditorToggle label="Send a push notification" value={push} onValueChange={setPush} disabled={!publish || Boolean(initial)} /></ScrollView></SafeAreaView></Modal>;
}
function EditorToggle({ label, value, onValueChange, disabled = false }: { label: string; value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean }) { return <View style={[styles.editorToggle, disabled && { opacity: 0.45 }]}><Text style={styles.editorToggleText}>{label}</Text><View style={styles.switchSlot}><Switch accessibilityLabel={label} disabled={disabled} value={value} onValueChange={onValueChange} trackColor={{ false: palette.line, true: '#6A2A36' }} thumbColor={value ? palette.rubySoft : palette.muted} style={styles.switch} /></View></View>; }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : 'Recently'; }
function formatRelative(value: string) { const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000)); if (minutes < 1) return 'Now'; if (minutes < 60) return `${minutes}m ago`; if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`; return formatDate(value); }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, eyebrow: { ...typography.label, color: palette.rubySoft, fontFamily: fonts.bold, letterSpacing: 1.8 }, heading: { ...typography.display, color: palette.text, fontFamily: fonts.extraBold, letterSpacing: -1.2 }, subhead: { ...typography.support, color: palette.muted, fontFamily: fonts.regular, marginTop: 4 }, compose: { width: 48, height: 48, borderRadius: 16, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' },
  tabs: { marginHorizontal: 20, padding: 4, borderRadius: 16, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', gap: 4 }, tab: { flex: 1, minHeight: 44, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, tabActive: { backgroundColor: palette.panelRaised }, tabText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 12 }, tabTextActive: { color: palette.text }, badge: { minWidth: 19, height: 19, borderRadius: 10, overflow: 'hidden', backgroundColor: palette.ruby, color: palette.text, fontFamily: fonts.bold, fontSize: 11, lineHeight: 19, textAlign: 'center', paddingHorizontal: 4 }, manageRow: { minHeight: 48, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, manageLabel: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 12 },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32, gap: 12, flexGrow: 1 }, card: { padding: 19, borderRadius: 22, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line }, unreadCard: { borderColor: '#5B2630', backgroundColor: '#171319' }, meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 13 }, icon: { width: 28, height: 28, borderRadius: 10, backgroundColor: palette.panelRaised, alignItems: 'center', justifyContent: 'center' }, scope: { flex: 1, color: palette.muted, fontFamily: fonts.bold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 }, statusPill: { color: palette.warning, backgroundColor: '#2A2112', borderRadius: 9, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4, fontFamily: fonts.bold, fontSize: 11, textTransform: 'uppercase' }, dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.rubySoft }, title: { color: palette.text, fontFamily: fonts.bold, fontSize: 18, lineHeight: 24 }, body: { color: '#BBC0CB', fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, marginTop: 9 }, cardFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 16 }, byline: { flex: 1, color: palette.subtle, fontFamily: fonts.medium, fontSize: 11 },
  markAll: { minHeight: 44, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 7 }, markAllText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 12 }, notification: { minHeight: 96, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, notificationUnread: { borderColor: '#5B2630', backgroundColor: '#171319' }, notificationIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: palette.panelRaised, alignItems: 'center', justifyContent: 'center' }, notificationIconUnread: { backgroundColor: '#2A151B' }, notificationCopy: { flex: 1 }, notificationTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 }, notificationBody: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, marginTop: 4 }, notificationTime: { color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, marginTop: 8 },
  empty: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 38 }, emptyTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 17 }, emptyCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(2,4,8,0.76)' }, sheet: { maxHeight: '86%', backgroundColor: palette.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: palette.line }, sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: palette.line, alignSelf: 'center', marginTop: 10 }, detail: { padding: 22, paddingTop: 16, paddingBottom: 36 }, detailTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, detailIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, detailScope: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 20 }, detailTitle: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 27, lineHeight: 34, letterSpacing: -0.6, marginTop: 7 }, detailBody: { color: '#C7CBD4', fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, marginTop: 18 }, detailAuthor: { color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, marginTop: 24 }, detailActions: { flexDirection: 'row', gap: 9, marginTop: 26 }, secondaryButton: { flex: 1, minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, secondaryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, archiveButton: { flex: 1, minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: '#4A2029', backgroundColor: '#211216', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, archiveText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 12 },
  editorSafe: { flex: 1, backgroundColor: palette.ink }, editorHeader: { minHeight: 64, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, editorTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 17 }, saveButton: { minWidth: 76, minHeight: 42, borderRadius: 13, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, saveText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, editorContent: { padding: 20, paddingBottom: 50 }, fieldLabel: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.3, marginTop: 18, marginBottom: 7 }, field: { minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, color: palette.text, fontFamily: fonts.regular, fontSize: 14, paddingHorizontal: 14 }, bodyField: { minHeight: 170, textAlignVertical: 'top', paddingTop: 14 }, choiceRow: { flexDirection: 'row', gap: 7 }, choice: { flex: 1, minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, alignItems: 'center', justifyContent: 'center' }, choiceActive: { borderColor: '#6A2A36', backgroundColor: '#2A151B' }, choiceText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11, textTransform: 'capitalize' }, choiceTextActive: { color: palette.rubySoft }, cohortList: { gap: 7 }, cohortChoice: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 }, editorToggle: { minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, editorToggleText: { flex: 1, color: palette.text, fontFamily: fonts.semibold, fontSize: 13 }, switchSlot: { width: 54, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, switch: { transform: [{ scaleX: 0.88 }, { scaleY: 0.88 }] },
});
