import { Platform } from 'react-native';

export const palette = {
  ink: '#0B0D12',
  panel: '#12151D',
  panelRaised: '#181C26',
  line: '#252A36',
  ruby: '#C51D34',
  rubySoft: '#F0445B',
  paper: '#F4F1EA',
  text: '#F3F4F6',
  muted: '#98A0B3',
  subtle: '#858EA2',
  quiet: '#626B7F',
  success: '#30B878',
  warning: '#E3A93B',
} as const;

/**
 * CSG family status roles (Brain Dump FRONTEND_DESIGN_GUIDE "CSG family
 * tokens"). Status chips use these exact values so a status reads the same on
 * web, native, and email: success for done, pending (slate + clock) for work
 * awaiting review, warning for redo. Red is reserved for errors.
 */
export const statusTones = {
  success: { text: '#15803d', background: '#f0fdf4', border: '#bbf7d0' },
  pending: { text: '#334155', background: '#f1f5f9', border: '#cbd5e1' },
  warning: { text: '#92400e', background: '#fffbeb', border: '#fde68a' },
  neutral: { text: '#334155', background: '#e2e8f0', border: '#cbd5e1' },
  quiet: { text: '#475569', background: '#f1f5f9', border: '#e2e8f0' },
} as const;

/** CSG family primary action (white text). New buttons use it ahead of the native redesign. */
export const csgPrimary = '#9c292b';

/** Monospace for code, submissions, and staff review on both platforms. */
export const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export const fonts = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extraBold: 'Manrope_800ExtraBold',
} as const;

/**
 * Semantic native type roles. React Native Text scales with the user's font
 * setting by default; these roles keep the starting sizes and line heights
 * consistent without disabling that behavior.
 */
export const typography = {
  display: { fontSize: 32, lineHeight: 39 },
  title: { fontSize: 22, lineHeight: 29 },
  section: { fontSize: 17, lineHeight: 24 },
  body: { fontSize: 14, lineHeight: 21 },
  support: { fontSize: 13, lineHeight: 19 },
  label: { fontSize: 11, lineHeight: 16 },
  meta: { fontSize: 11, lineHeight: 16 },
  code: { fontSize: 12, lineHeight: 18 },
} as const;

export const fontScaleLimits = {
  display: 1.6,
  title: 1.8,
  content: 2.2,
  utility: 2,
} as const;
