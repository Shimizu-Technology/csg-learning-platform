import { makeStyles } from '@/providers/theme-provider';
import { Button } from './ui/button';
import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/constants/csg-theme';
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
    return <ErrorFallback onRetry={() => this.setState({ error: null })} />;
  }
}
function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const styles = useStyles();
  return <View accessibilityRole="alert" style={styles.root}>
    <Text style={styles.title}>Let’s get you back on track.</Text>
    <Text style={styles.copy}>Something unexpected interrupted this screen. Your saved work and message drafts are still safe.</Text>
    <Button onPress={onRetry} label="Try this screen again" />
  </View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 30, backgroundColor: c.surface.page },
  badge: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: c.action.primary },
  badgeText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14, letterSpacing: 1 },
  title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 22, textAlign: 'center' },
  copy: { maxWidth: 340, color: c.text.body, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  button: { minHeight: 48, justifyContent: 'center', marginTop: 6, paddingHorizontal: 20, borderRadius: 14, backgroundColor: c.action.primary },
  buttonText: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 14 },
}));
