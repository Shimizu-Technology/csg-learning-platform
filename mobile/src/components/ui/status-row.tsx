import { StyleSheet, Text, View } from 'react-native';
import { fonts, typography } from '@/constants/csg-theme';
import { LEARNER_STATUS, type LearnerStatus } from '@/lib/learning-status';
import { makeStyles } from '@/providers/theme-provider';
import { Badge } from './badge';
export function StatusRow({ status, detail }: { status: LearnerStatus; detail?: string }) {
  const styles = useStyles(); const meta = LEARNER_STATUS[status];
  return <View style={styles.row}><Badge label={meta.label} tone={meta.tone === 'quiet' ? 'neutral' : meta.tone} />{detail && <Text style={styles.detail}>{detail}</Text>}</View>;
}
const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({ row: { gap: 8 }, detail: { ...typography.support, color: c.text.body, fontFamily: fonts.regular } }));
