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
