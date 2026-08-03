import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, palette } from '@/constants/csg-theme';
import { analyticsClient } from '@/lib/analytics';

type State = { error: Error | null };

export class AppErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    analyticsClient?.captureException(error, {
      surface: 'native_app',
      component_stack_available: Boolean(info.componentStack),
    });
    void analyticsClient?.flush();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View accessibilityRole="alert" style={styles.root}>
        <View style={styles.badge}><Text style={styles.badgeText}>CSG</Text></View>
        <Text style={styles.title}>Let’s get you back on track.</Text>
        <Text style={styles.copy}>Something unexpected interrupted this screen. Your saved work and message drafts are still safe.</Text>
        <Pressable accessibilityRole="button" onPress={() => this.setState({ error: null })} style={styles.button}>
          <Text style={styles.buttonText}>Try this screen again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 30, backgroundColor: palette.ink },
  badge: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: palette.ruby },
  badgeText: { color: palette.text, fontFamily: fonts.bold, fontSize: 14, letterSpacing: 1 },
  title: { color: palette.text, fontFamily: fonts.bold, fontSize: 22, textAlign: 'center' },
  copy: { maxWidth: 340, color: palette.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  button: { minHeight: 48, justifyContent: 'center', marginTop: 6, paddingHorizontal: 20, borderRadius: 14, backgroundColor: palette.ruby },
  buttonText: { color: palette.text, fontFamily: fonts.semibold, fontSize: 14 },
});
