import { useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import { Pressable } from 'react-native';
import { useTheme } from '@/providers/theme-provider';

export function SearchHeaderButton() {
  const router = useRouter();
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel="Search" onPress={() => router.push('/search')} style={{ alignSelf: 'flex-end', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Search size={22} color={colors.text.strong} /></Pressable>;
}
