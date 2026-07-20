import { AuthView } from '@clerk/expo/native';
import { MessageCircle } from 'lucide-react-native';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { fonts, palette } from '@/constants/csg-theme';

export default function SignIn() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.brand}>
        <View style={styles.mark}><MessageCircle color={palette.text} size={24} strokeWidth={2.2} /></View>
        <View><Text style={styles.eyebrow}>CODE SCHOOL OF GUAM</Text><Text style={styles.title}>CSG Connect</Text></View>
      </View>
      <Text style={styles.copy}>Your class conversations, questions, and important updates — wherever you are.</Text>
      <View style={styles.auth}><AuthView mode="signIn" isDismissible={false} logoMaxHeight={36} /></View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink, paddingHorizontal: 24 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 30 },
  mark: { width: 48, height: 48, borderRadius: 16, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: palette.muted, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.7 },
  title: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 26, letterSpacing: -0.8 },
  copy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 16, lineHeight: 25, marginTop: 28, maxWidth: 330 },
  auth: { flex: 1, overflow: 'hidden', marginHorizontal: -24, marginTop: 18 },
});
