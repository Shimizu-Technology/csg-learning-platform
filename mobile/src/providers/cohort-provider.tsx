import { useGlobalSearchParams, usePathname } from 'expo-router';
import { AccessibilityInfo, Platform, Text, View } from 'react-native';
import { useTheme } from './theme-provider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { demoDashboard } from '@/lib/demo-learning';
import { demoStaffDashboard } from '@/lib/demo-staff';
import type { AccessibleCohort } from '@/lib/types';
import { useCsgAuth } from './auth-provider';
import { useSession } from './session-provider';

type CohortContextValue = {
  cohorts: AccessibleCohort[];
  selectedCohortId: number | null;
  selectedCohort: AccessibleCohort | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  selectCohort: (cohortId: number | null) => Promise<void>;
};

const CohortContext = createContext<CohortContextValue | null>(null);
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
  const { api, user } = useSession();
  const userId = user?.id ?? null;
  const isAdmin = Boolean(user?.is_admin);
  const isStaff = Boolean(user?.is_staff);
  const [cohorts, setCohorts] = useState<AccessibleCohort[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshGenerationRef = useRef(0);
  const activeUserIdRef = useRef(userId);

  const refresh = useCallback(async () => {
    const generation = ++refreshGenerationRef.current;
    const isCurrent = () => generation === refreshGenerationRef.current && activeUserIdRef.current === userId;
    if (!userId) {
      setCohorts([]);
      setSelectedCohortId(null);
      setLoading(false);
      return;
    }
    try {
      const next = auth.demo ? demoCohorts(isStaff) : (await api.accessibleCohorts()).cohorts;
      const stored = await AsyncStorage.getItem(selectedCohortStorageKey(userId));
      const storedId = stored === 'all' ? null : Number(stored);
      const validStored = stored === 'all' ? isAdmin : Number.isInteger(storedId) && next.some((cohort) => cohort.id === storedId);
      const selected = validStored ? storedId : defaultCohortId(next, isAdmin);
      if (!isCurrent()) return;
      setCohorts(next);
      setSelectedCohortId(selected);
      setError(null);
      if (!validStored) await AsyncStorage.setItem(selectedCohortStorageKey(userId), selected === null ? 'all' : String(selected));
    } catch (requestError) {
      if (isCurrent()) setError((requestError as Error).message);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [api, auth.demo, isAdmin, isStaff, userId]);

  useEffect(() => {
    activeUserIdRef.current = userId;
    refreshGenerationRef.current += 1;
    const frame = requestAnimationFrame(() => {
      setCohorts([]);
      setSelectedCohortId(null);
      setLoading(true);
      void refresh();
    });
    return () => { cancelAnimationFrame(frame); refreshGenerationRef.current += 1; };
  }, [refresh, userId]);

  const selectCohort = useCallback(async (cohortId: number | null) => {
    if (!userId || (cohortId === null && !isAdmin) || (cohortId !== null && !cohorts.some((cohort) => cohort.id === cohortId))) return;
    refreshGenerationRef.current += 1;
    setSelectedCohortId(cohortId);
    await AsyncStorage.setItem(selectedCohortStorageKey(userId), cohortId === null ? 'all' : String(cohortId));
  }, [cohorts, isAdmin, userId]);

  const selectCohortFromLink = useCallback(async (cohortId: number) => {
    if (loading || selectedCohortId === cohortId) return;
    const cohort = cohorts.find((item) => item.id === cohortId);
    if (!cohort) return;
    const notice = `Switched to ${cohort.name}`;
    setSwitchNotice(notice);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibilityWithOptions(notice, { queue: true });
    await selectCohort(cohortId);
  }, [cohorts, loading, selectCohort, selectedCohortId]);

  useEffect(() => {
    // Navigation is external state; synchronize selection and notice before Updates clears its parameter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (explicitId) void selectCohortFromLink(explicitId);
  }, [explicitId, selectCohortFromLink]);
  useEffect(() => {
    if (!switchNotice) return;
    const timer = setTimeout(() => setSwitchNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [switchNotice]);

  const selectedCohort = useMemo(() => cohorts.find((cohort) => cohort.id === selectedCohortId) ?? null, [cohorts, selectedCohortId]);
  const value = useMemo(() => ({ cohorts, selectedCohortId, selectedCohort, loading, error, refresh, selectCohort }), [cohorts, selectedCohortId, selectedCohort, loading, error, refresh, selectCohort]);
  return <CohortContext.Provider value={value}>{children}{switchNotice && <View pointerEvents="none" style={{ position: 'absolute', bottom: 90, left: 20, right: 20, padding: 14, borderRadius: 12, backgroundColor: c.status.info.bg }}><Text accessibilityLiveRegion="polite" style={{ color: c.status.info.fg }}>{switchNotice}</Text></View>}</CohortContext.Provider>;
}

export function useCohort() {
  const context = useContext(CohortContext);
  if (!context) throw new Error('useCohort must be used within CohortProvider');
  return context;
}
