import { Platform } from 'react-native';

const iosFont = 'System';
const androidFont = 'sans-serif';
const webFont = '"Outfit", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const fonts = {
  regular: Platform.select({ ios: iosFont, android: androidFont, default: webFont }) ?? iosFont,
  medium: Platform.select({ ios: iosFont, android: 'sans-serif-medium', default: webFont }) ?? iosFont,
  semibold: Platform.select({ ios: iosFont, android: 'sans-serif-medium', default: webFont }) ?? iosFont,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) ?? 'Menlo',
};

export const colors = {
  background: '#0D1016',
  backgroundMuted: '#121720',
  surface: '#131821',
  surfaceElevated: '#161D27',
  surfaceActive: '#1B2431',
  border: '#1F2935',
  borderMuted: '#1B2530',
  overlay: 'rgba(13, 16, 22, 0.92)',
  textPrimary: '#F4F7FB',
  textSecondary: '#A1ADC5',
  textMuted: '#6B768A',
  accent: '#FF6B35',
  accentSoft: 'rgba(255, 107, 53, 0.12)',
  accentStrong: '#FF8C42',
  warning: '#F97316',
  danger: '#F97066',
  success: '#34D399',
  highlight: '#1F2937',
  inputBackground: '#10161F',
  inputBorder: '#243041',
  divider: 'rgba(255, 255, 255, 0.06)',
  glow: 'rgba(255, 107, 53, 0.35)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
};

export const shadows = {
  subtle: {
    shadowColor: 'rgba(0, 0, 0, 0.45)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  elevated: {
    shadowColor: 'rgba(255, 107, 53, 0.2)',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.3,
    shadowRadius: 32,
    elevation: 12,
  },
};

export const theme = {
  colors,
  spacing,
  radius,
  fonts,
  shadows,
};

export type Theme = typeof theme;
