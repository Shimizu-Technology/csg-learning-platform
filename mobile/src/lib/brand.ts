import { defaultLogoSvg } from './brand-mark';
/** Expo inlines direct EXPO_PUBLIC_* references at build time. */
export const brand = {
  logoSvg: process.env.EXPO_PUBLIC_LOGO_SVG || defaultLogoSvg,
  schoolName: process.env.EXPO_PUBLIC_SCHOOL_NAME || 'Code School of Guam',
  productName: process.env.EXPO_PUBLIC_PRODUCT_NAME || 'CSG Learn',
  schoolAbbreviation: process.env.EXPO_PUBLIC_SCHOOL_ABBREVIATION || 'CSG',
  schoolShortName: process.env.EXPO_PUBLIC_SCHOOL_SHORT_NAME || 'Code School',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'codeschoolofguam@gmail.com',
  siteUrl: process.env.EXPO_PUBLIC_SCHOOL_SITE_URL || 'https://codeschoolofguam.com/',
  appUrl: (process.env.EXPO_PUBLIC_APP_URL || 'https://learn.codeschoolofguam.com').replace(/\/$/, ''),
};
export const SUPPORT_EMAIL = brand.supportEmail;
