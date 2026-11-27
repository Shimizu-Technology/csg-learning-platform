import { useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import { StyleSheet } from 'react-native';
import { PressableScale } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';

export function SearchHeaderButton({ inline = false }: { inline?: boolean }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Search"
      onPress={() => router.push('/search')}
      style={[styles.button, !inline && styles.standalone]}
    >
      <Search size={20} color={colors.text.strong} />
    </PressableScale>
  );
}

const useStyles = makeStyles(({ colors: c, radius }) => StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  standalone: { alignSelf: 'flex-end' },
}));
