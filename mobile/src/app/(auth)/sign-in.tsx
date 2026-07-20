import { useSignIn, useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts, palette } from '@/constants/csg-theme';
import { authErrorMessage, isAuthCancellation } from '@/lib/auth-errors';

WebBrowser.maybeCompleteAuthSession();

const OAUTH_REDIRECT_URL = AuthSession.makeRedirectUri({
  scheme: 'csgconnect',
  path: 'oauth-callback',
});

type AuthStep = 'methods' | 'password' | 'verification' | 'reset-code' | 'new-password';
type VerificationStrategy = 'email_code' | 'phone_code' | 'totp';

export default function SignIn() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<AuthStep>('methods');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [socialLoading, setSocialLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [verificationStrategy, setVerificationStrategy] = useState<VerificationStrategy>('email_code');

  const loading = socialLoading || fetchStatus === 'fetching';
  const fieldError = errors.fields.identifier ?? errors.fields.password ?? errors.fields.code;
  const visibleError = message ?? fieldError?.longMessage ?? fieldError?.message ?? errors.global?.[0]?.message ?? null;
  const emailValue = email.trim().toLowerCase();

  const heading = useMemo(() => {
    if (step === 'verification') return 'Confirm it’s you';
    if (step === 'reset-code') return 'Check your inbox';
    if (step === 'new-password') return 'Choose a new password';
    return 'Welcome back';
  }, [step]);

  const description = useMemo(() => {
    if (step === 'verification') {
      if (verificationStrategy === 'totp') return 'Enter the code from your authenticator app.';
      return `Enter the verification code sent to ${emailValue}.`;
    }
    if (step === 'reset-code') return `We sent a password reset code to ${emailValue}.`;
    if (step === 'new-password') return 'Use at least eight characters for your new password.';
    return 'Use the account connected to your Code School cohort.';
  }, [emailValue, step, verificationStrategy]);

  function clearError() {
    if (message) setMessage(null);
  }

  function returnToMethods() {
    void signIn.reset();
    setStep('methods');
    setCode('');
    setPassword('');
    setMessage(null);
  }

  async function finalizePasswordSignIn() {
    const result = await signIn.finalize();
    if (result.error) setMessage(authErrorMessage(result.error, 'We could not finish signing you in. Please try again.'));
  }

  async function prepareSecondFactor() {
    const strategies = signIn.supportedSecondFactors.map((factor) => factor.strategy);

    if (strategies.includes('email_code')) {
      const result = await signIn.mfa.sendEmailCode();
      if (result.error) throw result.error;
      setVerificationStrategy('email_code');
    } else if (strategies.includes('phone_code')) {
      const result = await signIn.mfa.sendPhoneCode();
      if (result.error) throw result.error;
      setVerificationStrategy('phone_code');
    } else if (strategies.includes('totp')) {
      setVerificationStrategy('totp');
    } else {
      throw new Error('This account needs an authentication method that is not available in the mobile app. Try Google sign-in or contact Code School support.');
    }

    setCode('');
    setStep('verification');
  }

  async function handleGoogleSignIn() {
    setSocialLoading(true);
    setMessage(null);
    try {
      const result = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: OAUTH_REDIRECT_URL,
      });

      if (result.createdSessionId && result.setActive) {
        await result.setActive({ session: result.createdSessionId });
        return;
      }

      if (result.authSessionResult?.type !== 'cancel' && result.authSessionResult?.type !== 'dismiss') {
        setMessage('Google sign-in did not finish. Please try again or use your email and password.');
      }
    } catch (error) {
      if (!isAuthCancellation(error)) {
        setMessage(authErrorMessage(error, 'Google sign-in is unavailable right now. Please try again or use email.'));
      }
    } finally {
      setSocialLoading(false);
    }
  }

  async function handlePasswordSignIn() {
    if (!emailValue || !password) {
      setMessage('Enter your email and password.');
      return;
    }

    setMessage(null);
    try {
      const result = await signIn.password({ emailAddress: emailValue, password });
      if (result.error) throw result.error;

      if (signIn.status === 'complete') {
        await finalizePasswordSignIn();
      } else if (signIn.status === 'needs_second_factor' || signIn.status === 'needs_client_trust') {
        await prepareSecondFactor();
      } else {
        setMessage('This account needs an additional sign-in step. Try Google sign-in or contact Code School support.');
      }
    } catch (error) {
      setMessage(authErrorMessage(error, 'We could not sign you in. Check your email and password, then try again.'));
    }
  }

  async function handleVerification() {
    if (!code.trim()) {
      setMessage('Enter the verification code.');
      return;
    }

    setMessage(null);
    try {
      const params = { code: code.trim() };
      const result = verificationStrategy === 'email_code'
        ? await signIn.mfa.verifyEmailCode(params)
        : verificationStrategy === 'phone_code'
          ? await signIn.mfa.verifyPhoneCode(params)
          : await signIn.mfa.verifyTOTP(params);
      if (result.error) throw result.error;

      if (signIn.status === 'complete') await finalizePasswordSignIn();
      else setMessage('That code could not complete sign-in. Please request a new code and try again.');
    } catch (error) {
      setMessage(authErrorMessage(error, 'That verification code is not valid. Please try again.'));
    }
  }

  async function handleForgotPassword() {
    if (!emailValue) {
      setMessage('Enter your email first, then choose “Forgot password?”');
      return;
    }

    setMessage(null);
    try {
      const createResult = await signIn.create({ identifier: emailValue });
      if (createResult.error) throw createResult.error;
      const sendResult = await signIn.resetPasswordEmailCode.sendCode();
      if (sendResult.error) throw sendResult.error;
      setCode('');
      setStep('reset-code');
    } catch (error) {
      setMessage(authErrorMessage(error, 'We could not send a reset code. Check your email and try again.'));
    }
  }

  async function handleResetCode() {
    if (!code.trim()) {
      setMessage('Enter the reset code from your email.');
      return;
    }

    setMessage(null);
    try {
      const result = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
      if (result.error) throw result.error;
      if (signIn.status === 'needs_new_password') {
        setPassword('');
        setCode('');
        setStep('new-password');
      } else {
        setMessage('That code could not be verified. Please request a new one.');
      }
    } catch (error) {
      setMessage(authErrorMessage(error, 'That reset code is not valid. Please try again.'));
    }
  }

  async function handleNewPassword() {
    if (password.length < 8) {
      setMessage('Your new password must be at least eight characters.');
      return;
    }

    setMessage(null);
    try {
      const result = await signIn.resetPasswordEmailCode.submitPassword({ password });
      if (result.error) throw result.error;
      if (signIn.status === 'complete') await finalizePasswordSignIn();
      else setMessage('We could not finish resetting your password. Please try again.');
    } catch (error) {
      setMessage(authErrorMessage(error, 'We could not update your password. Please try again.'));
    }
  }

  const submitLabel = step === 'verification'
    ? 'Verify and continue'
    : step === 'reset-code'
      ? 'Verify reset code'
      : step === 'new-password'
        ? 'Save new password'
        : 'Sign in';

  const handleSubmit = step === 'verification'
    ? handleVerification
    : step === 'reset-code'
      ? handleResetCode
      : step === 'new-password'
        ? handleNewPassword
        : handlePasswordSignIn;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View pointerEvents="none" style={styles.rubyGlow} />
      <View pointerEvents="none" style={styles.grid}>
        {Array.from({ length: 7 }, (_, index) => <View key={`v-${index}`} style={[styles.gridVertical, { left: `${index * 18}%` }]} />)}
        {Array.from({ length: 8 }, (_, index) => <View key={`h-${index}`} style={[styles.gridHorizontal, { top: `${index * 14}%` }]} />)}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 18) + 18 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandRow}>
            <View style={styles.mark}><MessageCircle color={palette.text} size={23} strokeWidth={2.3} /></View>
            <View>
              <Text style={styles.eyebrow}>CODE SCHOOL OF GUAM</Text>
              <Text style={styles.brandName}>CSG Connect</Text>
            </View>
          </View>

          <View style={styles.hero}>
            <View style={styles.accessPill}><ShieldCheck color={palette.success} size={14} /><Text style={styles.accessPillText}>Private cohort access</Text></View>
            <Text style={styles.heroTitle}>Class stays close.</Text>
            <Text style={styles.heroCopy}>Questions, announcements, and the people helping you move forward—all in one place.</Text>
          </View>

          <View style={styles.card}>
            {step !== 'methods' && (
              <Pressable accessibilityRole="button" accessibilityLabel="Back to sign-in methods" onPress={returnToMethods} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
                <ArrowLeft color={palette.muted} size={18} />
              </Pressable>
            )}

            <Text style={styles.cardTitle}>{heading}</Text>
            <Text style={styles.cardCopy}>{description}</Text>

            {visibleError && (
              <View accessibilityLiveRegion="polite" style={styles.errorBanner}>
                <AlertCircle color="#FF7B8D" size={18} />
                <Text style={styles.errorText}>{visibleError}</Text>
              </View>
            )}

            {step === 'methods' && (
              <>
                <Pressable accessibilityRole="button" onPress={() => void handleGoogleSignIn()} disabled={loading} style={({ pressed }) => [styles.googleButton, pressed && styles.pressed, loading && styles.disabled]}>
                  {socialLoading ? <ActivityIndicator color="#1A1D24" /> : <View style={styles.googleMark}><Text style={styles.googleMarkText}>G</Text></View>}
                  <Text style={styles.googleButtonText}>{socialLoading ? 'Opening Google…' : 'Continue with Google'}</Text>
                </Pressable>

                <View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>OR</Text><View style={styles.dividerLine} /></View>

                <Pressable accessibilityRole="button" onPress={() => { setStep('password'); setMessage(null); }} disabled={loading} style={({ pressed }) => [styles.emailButton, pressed && styles.pressed]}>
                  <LockKeyhole color={palette.text} size={18} />
                  <Text style={styles.emailButtonText}>Use email and password</Text>
                  <ArrowRight color={palette.quiet} size={18} />
                </Pressable>
              </>
            )}

            {step !== 'methods' && (
              <View style={styles.form}>
                {step === 'password' && (
                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Email address</Text>
                    <TextInput
                      accessibilityLabel="Email address"
                      autoCapitalize="none"
                      autoComplete="email"
                      autoCorrect={false}
                      keyboardType="email-address"
                      onChangeText={(value) => { setEmail(value); clearError(); }}
                      placeholder="you@example.com"
                      placeholderTextColor={palette.quiet}
                      returnKeyType="next"
                      style={styles.input}
                      value={email}
                    />
                  </View>
                )}

                {(step === 'password' || step === 'new-password') && (
                  <View style={styles.fieldGroup}>
                    <View style={styles.labelRow}>
                      <Text style={styles.label}>{step === 'new-password' ? 'New password' : 'Password'}</Text>
                      {step === 'password' && <Pressable hitSlop={10} onPress={() => void handleForgotPassword()}><Text style={styles.forgotText}>Forgot password?</Text></Pressable>}
                    </View>
                    <View style={styles.passwordField}>
                      <TextInput
                        accessibilityLabel={step === 'new-password' ? 'New password' : 'Password'}
                        autoCapitalize="none"
                        autoComplete={step === 'new-password' ? 'new-password' : 'current-password'}
                        onChangeText={(value) => { setPassword(value); clearError(); }}
                        onSubmitEditing={() => void handleSubmit()}
                        placeholder={step === 'new-password' ? 'At least 8 characters' : 'Enter your password'}
                        placeholderTextColor={palette.quiet}
                        returnKeyType="go"
                        secureTextEntry={!showPassword}
                        style={styles.passwordInput}
                        value={password}
                      />
                      <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} hitSlop={10} onPress={() => setShowPassword((visible) => !visible)} style={styles.eyeButton}>
                        {showPassword ? <EyeOff color={palette.muted} size={19} /> : <Eye color={palette.muted} size={19} />}
                      </Pressable>
                    </View>
                  </View>
                )}

                {(step === 'verification' || step === 'reset-code') && (
                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Verification code</Text>
                    <TextInput
                      accessibilityLabel="Verification code"
                      autoComplete="one-time-code"
                      keyboardType="number-pad"
                      maxLength={8}
                      onChangeText={(value) => { setCode(value); clearError(); }}
                      onSubmitEditing={() => void handleSubmit()}
                      placeholder="Enter code"
                      placeholderTextColor={palette.quiet}
                      returnKeyType="done"
                      style={[styles.input, styles.codeInput]}
                      value={code}
                    />
                  </View>
                )}

                <Pressable accessibilityRole="button" onPress={() => void handleSubmit()} disabled={loading} style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed, loading && styles.disabled]}>
                  {loading ? <ActivityIndicator color={palette.text} /> : <><Text style={styles.primaryButtonText}>{submitLabel}</Text><ArrowRight color={palette.text} size={18} /></>}
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.footer}>
            <LockKeyhole color={palette.quiet} size={13} />
            <Text style={styles.footerText}>Access is limited to Code School students and staff.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink },
  flex: { flex: 1 },
  rubyGlow: { position: 'absolute', top: -120, right: -100, width: 320, height: 320, borderRadius: 160, backgroundColor: '#351019', opacity: 0.82 },
  grid: { position: 'absolute', inset: 0, opacity: 0.25, overflow: 'hidden' },
  gridVertical: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: palette.line },
  gridHorizontal: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: palette.line },
  content: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 16 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  mark: { width: 46, height: 46, borderRadius: 15, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center', shadowColor: palette.ruby, shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 7 } },
  eyebrow: { color: palette.muted, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1.8 },
  brandName: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 22, letterSpacing: -0.7, marginTop: 1 },
  hero: { marginTop: 34, marginBottom: 26 },
  accessPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 30, borderRadius: 15, paddingHorizontal: 10, backgroundColor: '#12241E', borderWidth: 1, borderColor: '#24493A' },
  accessPillText: { color: '#76D7AA', fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.25 },
  heroTitle: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 40, lineHeight: 44, letterSpacing: -1.8, marginTop: 15 },
  heroCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, marginTop: 10, maxWidth: 350 },
  card: { borderRadius: 24, backgroundColor: 'rgba(18, 21, 29, 0.96)', borderWidth: 1, borderColor: '#2B303D', padding: 20, shadowColor: '#000', shadowOpacity: 0.32, shadowRadius: 28, shadowOffset: { width: 0, height: 14 } },
  backButton: { width: 44, height: 44, marginLeft: -10, marginTop: -10, marginBottom: 2, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 25, lineHeight: 31, letterSpacing: -0.8 },
  cardCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, marginTop: 5 },
  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 16, padding: 12, borderRadius: 14, backgroundColor: '#2A141A', borderWidth: 1, borderColor: '#5A2934' },
  errorText: { flex: 1, color: '#FF9AA8', fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
  googleButton: { minHeight: 54, borderRadius: 15, backgroundColor: palette.paper, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 20 },
  googleMark: { width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  googleMarkText: { color: '#4285F4', fontFamily: fonts.extraBold, fontSize: 17, letterSpacing: -1 },
  googleButtonText: { color: '#1A1D24', fontFamily: fonts.bold, fontSize: 14 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 11, marginVertical: 17 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.line },
  dividerText: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1.3 },
  emailButton: { minHeight: 54, borderRadius: 15, borderWidth: 1, borderColor: '#353B49', backgroundColor: palette.panelRaised, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 11 },
  emailButtonText: { flex: 1, color: palette.text, fontFamily: fonts.bold, fontSize: 13 },
  form: { gap: 16, marginTop: 20 },
  fieldGroup: { gap: 7 },
  labelRow: { minHeight: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: '#C7CCD7', fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.15 },
  forgotText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11 },
  input: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: '#353B49', backgroundColor: palette.ink, color: palette.text, fontFamily: fonts.medium, fontSize: 14, paddingHorizontal: 15 },
  passwordField: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: '#353B49', backgroundColor: palette.ink, flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1, minHeight: 50, color: palette.text, fontFamily: fonts.medium, fontSize: 14, paddingLeft: 15, paddingRight: 6 },
  eyeButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  codeInput: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: 4, textAlign: 'center' },
  primaryButton: { minHeight: 54, borderRadius: 15, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 2 },
  primaryPressed: { backgroundColor: '#A9172B' },
  primaryButtonText: { color: palette.text, fontFamily: fonts.bold, fontSize: 14 },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.55 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 18 },
  footerText: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 10.5 },
});
