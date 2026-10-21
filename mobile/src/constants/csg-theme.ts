import { Platform } from 'react-native';

/** CSG family roles. Placeholder is decorative; use text.muted for readable input hints. */
export const lightColors = {
  surface: { page: '#f8f7f4', raised: '#ffffff', sunken: '#f3f2ee', inverse: '#0f172a', brandPublic: '#faf7f0' },
  text: { strong: '#0f172a', body: '#475569', muted: '#64748b', placeholder: '#94a3b8', onAction: '#ffffff' },
  border: { subtle: '#e2e8f0', strong: '#cbd5e1' },
  action: { primary: '#9c292b', primaryPressed: '#6f1c1f', primaryHover: '#842225' },
  brand: { tile: '#191920' },
  status: {
    danger: { fg: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
    warning: { fg: '#92400e', bg: '#fffbeb', border: '#fde68a' },
    success: { fg: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
    pending: { fg: '#334155', bg: '#f1f5f9', border: '#cbd5e1' },
    info: { fg: '#075985', bg: '#f0f9ff', border: '#bae6fd' },
  },
  focus: '#1d4ed8', selection: { bg: '#f1f5f9', indicator: '#9c292b' },
  code: { bg: '#0f172a', fg: '#f8fafc', muted: '#cbd5e1', border: '#475569', success: '#86efac' },
  media: { bg: '#000000', fg: '#ffffff', scrim: 'rgba(0,0,0,0.72)' },
  overlay: 'rgba(15,23,42,0.48)',
} as const;

type ColorShape<T> = { [K in keyof T]: T[K] extends string ? string : ColorShape<T[K]> };
export type ThemeColors = ColorShape<typeof lightColors>;
export const darkColors: ThemeColors = {
  surface: { page: '#0f172a', raised: '#111827', sunken: '#020617', inverse: '#f8fafc', brandPublic: '#0f172a' },
  text: { strong: '#f8fafc', body: '#cbd5e1', muted: '#94a3b8', placeholder: '#64748b', onAction: '#ffffff' },
  border: { subtle: '#334155', strong: '#475569' },
  action: { primary: '#b8393b', primaryPressed: '#9c292b', primaryHover: '#a83235' },
  brand: lightColors.brand,
  status: {
    danger: { fg: '#fca5a5', bg: '#2a1215', border: '#7f1d1d' },
    warning: { fg: '#fcd34d', bg: '#292013', border: '#854d0e' },
    success: { fg: '#86efac', bg: '#10271f', border: '#166534' },
    pending: { fg: '#cbd5e1', bg: '#1e293b', border: '#475569' },
    info: { fg: '#7dd3fc', bg: '#082536', border: '#075985' },
  },
  focus: '#bfdbfe', selection: { bg: '#1e293b', indicator: '#b8393b' },
  code: { bg: '#020617', fg: '#f8fafc', muted: '#cbd5e1', border: '#475569', success: '#86efac' },
  media: lightColors.media, overlay: 'rgba(0,0,0,0.72)',
};

export const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
export const fonts = { regular: 'Manrope_400Regular', medium: 'Manrope_500Medium', semibold: 'Manrope_600SemiBold', bold: 'Manrope_700Bold', extraBold: 'Manrope_800ExtraBold' } as const;
export const typography = {
  display: { fontSize: 30, lineHeight: 36 }, title: { fontSize: 22, lineHeight: 28 }, section: { fontSize: 18, lineHeight: 24 },
  body: { fontSize: 16, lineHeight: 24 }, prose: { fontSize: 17, lineHeight: 27 }, support: { fontSize: 14, lineHeight: 20 },
  label: { fontSize: 12, lineHeight: 16 }, meta: { fontSize: 12, lineHeight: 16 }, code: { fontSize: 14, lineHeight: 21, fontFamily: monoFont },
} as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, section: 48 } as const;
export const radius = { control: 12, card: 16, chip: 999, sheet: 24 } as const;
export const shadow = { raised: { shadowColor: lightColors.surface.inverse, shadowOpacity: 0.04, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }, overlay: { shadowColor: lightColors.surface.inverse, shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } } } as const;
export const minTarget = 44;
export const fontScaleLimits = { display: 1.6, title: 1.8, content: 2.2, utility: 2 } as const;
export function createTheme(scheme: 'light' | 'dark') {
  const colors: ThemeColors = scheme === 'dark' ? darkColors : lightColors;
  const statusTones = Object.fromEntries(Object.entries(colors.status).map(([key, c]) => [key, { text: c.fg, background: c.bg, border: c.border }])) as Record<keyof ThemeColors['status'], { text: string; background: string; border: string }>;
  return { scheme, dark: scheme === 'dark', colors, typography, fonts, space, radius, shadow, minTarget,
    statusTones: { ...statusTones, neutral: statusTones.pending, quiet: { text: colors.text.body, background: colors.selection.bg, border: colors.border.subtle } } };
}
export type CsgTheme = ReturnType<typeof createTheme>;
export const themes = { light: createTheme('light'), dark: createTheme('dark') };

// Temporary compatibility for screens migrating in the immediately stacked PR 3b.
export const palette = { ink: darkColors.surface.page, panel: darkColors.surface.raised, panelRaised: darkColors.surface.sunken, line: darkColors.border.subtle, ruby: darkColors.action.primary, rubySoft: darkColors.text.body, paper: darkColors.text.strong, text: darkColors.text.strong, muted: darkColors.text.body, subtle: darkColors.text.muted, quiet: darkColors.text.muted, success: darkColors.status.success.fg, warning: darkColors.status.warning.fg };
export const statusTones = themes.dark.statusTones;
export const csgPrimary = lightColors.action.primary;
