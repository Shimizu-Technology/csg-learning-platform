import { defaultLogoSvg } from './brand-mark';
/** Expo inlines direct EXPO_PUBLIC_* references at build time. */
export function createBrand(env: Record<string, string | undefined>) {
  env = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : undefined]));
  const url = (key: string, fallback: string, origin = false) => {
    const value = env[key] || fallback;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || /\s/.test(value)
        || (origin && (parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)))) throw new Error();
      return value;
    } catch {
      throw new Error(`${key} must be an absolute HTTPS ${origin ? 'origin without a path' : 'URL'}`);
    }
  };
  return {
    logoSvg: env.EXPO_PUBLIC_LOGO_SVG || defaultLogoSvg,
    schoolName: env.EXPO_PUBLIC_SCHOOL_NAME || 'Code School of Guam',
    productName: env.EXPO_PUBLIC_PRODUCT_NAME || 'CSG Learn',
    schoolAbbreviation: env.EXPO_PUBLIC_SCHOOL_ABBREVIATION || 'CSG',
    schoolShortName: env.EXPO_PUBLIC_SCHOOL_SHORT_NAME || 'Code School',
    supportEmail: env.EXPO_PUBLIC_SUPPORT_EMAIL || 'codeschoolofguam@gmail.com',
    siteUrl: url('EXPO_PUBLIC_SCHOOL_SITE_URL', 'https://codeschoolofguam.com/'),
    appUrl: (url('EXPO_PUBLIC_APP_URL', 'https://learn.codeschoolofguam.com', true)).replace(/\/$/, ''),
  };
}
export const brand = createBrand({
  EXPO_PUBLIC_LOGO_SVG: process.env.EXPO_PUBLIC_LOGO_SVG,
  EXPO_PUBLIC_SCHOOL_NAME: process.env.EXPO_PUBLIC_SCHOOL_NAME,
  EXPO_PUBLIC_PRODUCT_NAME: process.env.EXPO_PUBLIC_PRODUCT_NAME,
  EXPO_PUBLIC_SCHOOL_ABBREVIATION: process.env.EXPO_PUBLIC_SCHOOL_ABBREVIATION,
  EXPO_PUBLIC_SCHOOL_SHORT_NAME: process.env.EXPO_PUBLIC_SCHOOL_SHORT_NAME,
  EXPO_PUBLIC_SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL,
  EXPO_PUBLIC_SCHOOL_SITE_URL: process.env.EXPO_PUBLIC_SCHOOL_SITE_URL,
  EXPO_PUBLIC_APP_URL: process.env.EXPO_PUBLIC_APP_URL,
});
export const SUPPORT_EMAIL = brand.supportEmail;
