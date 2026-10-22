import { useGlobalSearchParams, usePathname } from 'expo-router';
import { AccessibilityInfo, AppState, Platform, Text, View } from 'react-native';
import * as Network from 'expo-network';
import { canReadCachedEnrollment, canUseCachedSession } from '@/lib/session-access';
import { useTheme } from './theme-provider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { fonts } from '@/constants/csg-theme';
import { demoDashboard } from '@/lib/demo-learning';
import { demoStaffDashboard } from '@/lib/demo-staff';
import type { AccessibleCohort, SessionEnrollment } from '@/lib/types';
import { useCsgAuth } from './auth-provider';
import { useSession } from './session-provider';

type CohortContextValue = {
  cohorts: AccessibleCohort[];
  selectedCohortId: number | null;
  selectedCohort: AccessibleCohort | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  refresh: () => Promise<void>;
  selectCohort: (cohortId: number | null) => Promise<void>;
};

type CohortContextState = Omit<CohortContextValue, 'selectedCohort' | 'stale'> & {
  cachedEnrollments: SessionEnrollment[] | null;
};

// Evaluate deadlines at the point of use, including consumer-only renders after
// background suspension. A timer merely prompts a render; it never grants access.
function readableCohorts(cohorts: AccessibleCohort[], cachedEnrollments: SessionEnrollment[] | null) {
  if (cachedEnrollments === null) return cohorts;
  const now = Date.now();
  const readableIds = new Set(cachedEnrollments.filter(enrollment => canReadCachedEnrollment(enrollment, now)).map(enrollment => enrollment.cohort.id));
  return cohorts.filter(cohort => readableIds.has(cohort.id));
}

const CohortContext = createContext<CohortContextState | null>(null);
export const selectedCohortStorageKey = (userId: number) => `csg.cohort.active.${userId}`;

function defaultCohortId(cohorts: AccessibleCohort[], isAdmin: boolean): number | null {
  if (isAdmin) return null;
  return cohorts.find((cohort) => cohort.status === 'active' && cohort.cohort_type !== 'alumni')?.id
    ?? cohorts.find((cohort) => cohort.status === 'upcoming')?.id
    ?? cohorts.find((cohort) => cohort.status === 'active')?.id
    ?? cohorts[0]?.id ?? null;
}

function demoCohorts(isStaff: boolean): AccessibleCohort[] {
  if (isStaff) return demoStaffDashboard.cohorts.map(({ cohort }) => ({
    id: cohort.id, name: cohort.name, status: cohort.status, cohort_type: cohort.id === 5 ? 'alumni' : 'bootcamp',
    curriculum_name: 'Code School curriculum', workspace_id: cohort.id === 4 ? 1 : cohort.id === 5 ? 3 : null, enrollment_status: null,
  }));
  return demoDashboard.cohort ? [{
    id: demoDashboard.cohort.id, name: demoDashboard.cohort.name,
    status: demoDashboard.cohort.status, cohort_type: demoDashboard.cohort.cohort_type,
    curriculum_name: 'Code School curriculum', workspace_id: demoDashboard.cohort.id === 4 ? 1 : null, enrollment_status: 'active',
  }] : [];
}

export function CohortProvider({ children }: PropsWithChildren) {
  const auth = useCsgAuth();
  const { colors: c } = useTheme();
  const params = useGlobalSearchParams<{ cohort_id?: string }>();
  const pathname = usePathname();
  const pathId = pathname.match(/^\/cohort\/([1-9]\d*)$/)?.[1];
  const explicitValue = pathId ?? params.cohort_id;
  const explicitId = typeof explicitValue === 'string' && /^[1-9]\d*$/.test(explicitValue) ? Number(explicitValue) : null;
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);
  const { api, user, enrollments } = useSession();
  const cachedEnrollmentsRef = useRef(enrollments);
  useLayoutEffect(() => { cachedEnrollmentsRef.current = enrollments; }, [enrollments]);
  const userId = user?.id ?? null;
  const isAdmin = Boolean(user?.is_admin);
  const isStaff = Boolean(user?.is_staff);
  const [contextUserId, setContextUserId] = useState<number | null>(null);
  const [cohorts, setCohorts] = useState<AccessibleCohort[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [deadlineTick, setDeadlineTick] = useState(0);
  const [validationFailures, setValidationFailures] = useState(0);
  const needsRevalidation = validationFailures > 0;
  const [error, setError] = useState<string | null>(null);
  const validationGenerationRef = useRef(0);
  const activeUserIdRef = useRef(userId);
  const selectionRef = useRef<number | null | undefined>(undefined);
  const validationRequestRef = useRef<{ generation: number; promise: Promise<void> } | null>(null);
  const visibleCohorts = readableCohorts(cohorts, needsRevalidation ? enrollments : null);
  const stale = needsRevalidation && visibleCohorts.some(cohort => cohort.id === selectedCohortId);

  const refresh = useCallback(async () => {
    // Coalesce access validation; selection changes never cancel a valid result.
    const pending = validationRequestRef.current;
    if (pending?.generation === validationGenerationRef.current) return pending.promise;
    const generation = ++validationGenerationRef.current;
    const isCurrent = () => generation === validationGenerationRef.current && activeUserIdRef.current === userId;
    const validate = async () => {
      if (!userId) {
        setCohorts([]);
        setSelectedCohortId(null);
        setValidationFailures(0);
        setError(null);
        api.setCohortContextReadOnly(false);
        setLoading(false);
        return;
      }
      try {
        const next = auth.demo ? demoCohorts(isStaff) : (await api.accessibleCohorts()).cohorts;
        const stored = await AsyncStorage.getItem(selectedCohortStorageKey(userId)).catch(() => null);
        if (!isCurrent()) return;
        // Re-resolve the latest user choice against fresh access, even when the
        // choice changed while the request or storage read was pending.
        const candidate = selectionRef.current !== undefined ? selectionRef.current : stored === 'all' ? null : Number(stored);
        const valid = candidate === null ? isAdmin : next.some(cohort => cohort.id === candidate);
        const selected = valid ? candidate : defaultCohortId(next, isAdmin);
        selectionRef.current = selected;
        setCohorts(next);
        setSelectedCohortId(selected);
        setError(null);
        setValidationFailures(0);
        api.setCohortContextReadOnly(false);
        await AsyncStorage.setItem(selectedCohortStorageKey(userId), selected === null ? 'all' : String(selected)).catch(() => undefined);
      } catch (requestError) {
        if (!isCurrent()) return;
        const stored = await AsyncStorage.getItem(selectedCohortStorageKey(userId)).catch(() => null);
        if (!isCurrent()) return;
        // Cache membership and selection are independent. Expiring the selected
        // cohort must not stop visibility checks for the remaining saved cohorts.
        const saved: AccessibleCohort[] = canUseCachedSession(requestError) ? cachedEnrollmentsRef.current
          .filter(enrollment => canReadCachedEnrollment(enrollment))
          .map(enrollment => ({ ...enrollment.cohort, curriculum_name: '', workspace_id: null, enrollment_status: enrollment.status })) : [];
        const candidate = selectionRef.current !== undefined ? selectionRef.current : Number(stored);
        const selected = saved.some(item => item.id === candidate) ? candidate : null;
        selectionRef.current = selected;
        setCohorts(saved);
        setSelectedCohortId(selected);
        setValidationFailures(attempt => attempt + 1);
        api.setCohortContextReadOnly(true);
        setError((requestError as Error).message);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    };
    const promise = validate();
    validationRequestRef.current = { generation, promise };
    try { await promise; }
    finally {
      if (validationRequestRef.current?.promise === promise) validationRequestRef.current = null;
    }
  }, [api, auth.demo, isAdmin, isStaff, userId]);

  useLayoutEffect(() => {
    activeUserIdRef.current = userId;
    selectionRef.current = undefined;
    validationGenerationRef.current += 1;
    api.setCohortContextReadOnly(true);
    const frame = requestAnimationFrame(() => {
      setContextUserId(userId);
      setSwitchNotice(null);
      setCohorts([]);
      setSelectedCohortId(null);
      setLoading(true);
      setValidationFailures(0);
      setError(null);
      void refresh();
    });
    return () => { cancelAnimationFrame(frame); validationGenerationRef.current += 1; };
  }, [api, refresh, userId]);

  useEffect(() => {
    if (!needsRevalidation) return;
    const network = Network.addNetworkStateListener(state => {
      if (state.isConnected && state.isInternetReachable !== false) void refresh();
    });
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active') {
        setDeadlineTick(tick => tick + 1);
        void refresh();
      }
    });
    // Connectivity may remain stable after a transient server failure. Keep one
    // bounded-backoff retry until validation succeeds, without needing an event.
    const timer = setTimeout(() => { void refresh(); }, Math.min(30_000, 1000 * 2 ** Math.min(5, Math.max(0, validationFailures - 1))));
    return () => { clearTimeout(timer); network.remove(); foreground.remove(); };
  }, [refresh, needsRevalidation, validationFailures]);

  useEffect(() => {
    if (!needsRevalidation) return;
    const now = Date.now();
    const deadlines = enrollments.filter(enrollment => cohorts.some(cohort => cohort.id === enrollment.cohort.id))
      .map(enrollment => Date.parse(enrollment.access_expires_at ?? ''))
      .filter(deadline => Number.isFinite(deadline) && deadline > now);
    if (!deadlines.length) return;
    // Re-arm for ALL remaining cached cohorts, regardless of current selection.
    const timer = setTimeout(() => setDeadlineTick(tick => tick + 1), Math.min(2_147_483_647, Math.min(...deadlines) - now));
    return () => clearTimeout(timer);
  }, [cohorts, enrollments, needsRevalidation, deadlineTick]);

  const selectCohort = useCallback(async (cohortId: number | null) => {
    if (!userId || (cohortId === null && !isAdmin) || (cohortId !== null && !readableCohorts(cohorts, needsRevalidation ? cachedEnrollmentsRef.current : null).some(cohort => cohort.id === cohortId))) return;
    selectionRef.current = cohortId;
    setSelectedCohortId(cohortId);
    await AsyncStorage.setItem(selectedCohortStorageKey(userId), cohortId === null ? 'all' : String(cohortId));
  }, [cohorts, isAdmin, userId, needsRevalidation]);

  const selectCohortFromLink = useCallback(async (cohortId: number) => {
    if (loading || selectedCohortId === cohortId) return;
    const cohort = readableCohorts(cohorts, needsRevalidation ? cachedEnrollmentsRef.current : null).find((item) => item.id === cohortId);
    if (!cohort) return;
    const notice = `Switched to ${cohort.name}`;
    setSwitchNotice(notice);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibilityWithOptions(notice, { queue: true });
    await selectCohort(cohortId);
  }, [cohorts, loading, selectCohort, selectedCohortId, needsRevalidation]);

  useEffect(() => {
    // Navigation is external state; synchronize selection and notice before Updates clears its parameter.
    if (explicitId) void selectCohortFromLink(explicitId);
  }, [explicitId, selectCohortFromLink]);
  useEffect(() => {
    if (!switchNotice) return;
    const timer = setTimeout(() => setSwitchNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [switchNotice]);

  const value: CohortContextState = contextUserId === userId
    ? { cohorts, selectedCohortId, cachedEnrollments: needsRevalidation ? enrollments : null, loading, error, refresh, selectCohort }
    : { cohorts: [], selectedCohortId: null, cachedEnrollments: null, loading: Boolean(userId), error: null, refresh, selectCohort };
  return <CohortContext.Provider value={value}>{children}{contextUserId === userId && (needsRevalidation || switchNotice) && <View pointerEvents="none" accessibilityRole={needsRevalidation ? 'alert' : undefined} style={{ position: 'absolute', bottom: 90, left: 20, right: 20, padding: 14, borderRadius: 12, backgroundColor: needsRevalidation ? c.status.warning.bg : c.status.info.bg }}><Text accessibilityLiveRegion="polite" style={{ color: needsRevalidation ? c.status.warning.fg : c.status.info.fg, fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 }}>{switchNotice}{needsRevalidation ? `${switchNotice ? '. ' : ''}Offline — changes paused. ${stale ? 'Saved cohort · read-only. ' : ''}Reconnect to refresh access and save changes.` : ''}</Text></View>}</CohortContext.Provider>;
}

export function useCohort(): CohortContextValue {
  const context = useContext(CohortContext);
  if (!context) throw new Error('useCohort must be used within CohortProvider');
  const { cachedEnrollments, ...value } = context;
  const cohorts = readableCohorts(value.cohorts, cachedEnrollments);
  const selectedCohort = cohorts.find(cohort => cohort.id === value.selectedCohortId) ?? null;
  return { ...value, cohorts, selectedCohort, selectedCohortId: selectedCohort?.id ?? null, stale: cachedEnrollments !== null && selectedCohort !== null };
}
