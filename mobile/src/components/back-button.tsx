import { type Href, usePathname, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { type StyleProp, type ViewStyle } from 'react-native';
import { PressableScale } from './ui/pressable-scale';
import { useTheme } from '@/providers/theme-provider';

export function parentDestination(path: string): { href: Href; label: string } | null {
  if (/^\/staff\/submission\//.test(path)) return { href: '/staff/grading', label: 'Grading' };
  if (/^\/staff\/(support|intervention)\//.test(path)) return { href: '/staff/support', label: 'Support' };
  if (/^\/staff\/lesson\//.test(path)) return { href: '/learn', label: 'Learn' };
  if (/^\/conversation\//.test(path) || /^\/thread\//.test(path)) return { href: '/messages', label: 'Messages' };
  if (/^\/cohort\/\d+\/schedule$/.test(path)) return { href: path.replace('/schedule', '') as Href, label: 'Cohort' };
  if (/^\/recording(?:s\/|\/)/.test(path)) return { href: '/recordings', label: 'Recordings' };
  if (/^\/(lesson|module|staff\/curriculum)\//.test(path)) return { href: '/learn', label: 'Learn' };
  return null;
}

export function useBackNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const parent = parentDestination(pathname);
  return { label: parent ? `Back to ${parent.label}` : 'Back to Today', goBack: () => {
    if (router.canGoBack()) router.back();
    else router.replace(parent?.href ?? '/');
  } };
}

/** onPress preserves editor cancel/unsaved-change guards before leaving. */
export function BackButton({ style, onPress, accessibilityLabel }: { style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  const { goBack, label } = useBackNavigation();
  return <PressableScale accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress ?? goBack} style={[style, { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }]}><ArrowLeft size={22} color={colors.text.strong} /></PressableScale>;
}
