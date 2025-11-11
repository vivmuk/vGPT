import { Platform } from 'react-native';

const palette = {
  black: '#000000',
  black_alt: '#0A0A0A',
  white: '#FFFFFF',
  gray_light: '#F5F5F5',
  gray: '#CCCCCC',
  gray_dark: '#888888',
  gray_darker: '#444444',
  gray_darkest: '#1E1E1E',

  neon_pink: '#F000FF', // Vivid magenta
  neon_cyan: '#00FFFF', // Bright cyan
  neon_green: '#39FF14', // Electric lime
  neon_orange: '#FF7F00', // Bright orange
};

export const theme = {
  colors: {
    background: palette.black_alt,
    backgroundMuted: palette.black,
    surface: palette.gray_darkest,
    surfaceElevated: '#101010',
    surfaceActive: palette.gray_darker,

    divider: '#282828',
    border: palette.gray_darker,
    borderMuted: '#333333',

    textPrimary: palette.gray_light,
    textSecondary: palette.gray,
    textMuted: palette.gray_dark,

    accent: palette.neon_cyan,
    accentStrong: palette.white,
    accentSoft: 'rgba(0, 255, 255, 0.1)',
    glow: palette.neon_cyan,

    inputBackground: '#050505',
    inputBorder: palette.gray_darker,
    
    success: palette.neon_green,
    warning: palette.neon_orange,
    danger: palette.neon_pink,

    // Neons for multi-color effects if needed
    neon: {
      pink: palette.neon_pink,
      cyan: palette.neon_cyan,
      green: palette.neon_green,
      orange: palette.neon_orange,
    }
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radius: {
    sm: 4,
    md: 8,
    lg: 16,
    pill: 9999,
  },
  fonts: {
    regular: Platform.OS === 'web' ? 'Outfit, sans-serif' : 'System',
    medium: Platform.OS === 'web' ? 'Outfit, sans-serif' : 'System',
    semibold: Platform.OS === 'web' ? 'Outfit, sans-serif' : 'System',
    bold: Platform.OS === 'web' ? 'Outfit, sans-serif' : 'System',
    mono: Platform.OS === 'web' ? 'monospace' : 'System',
  },
  shadows: {
    subtle: {
      shadowColor: palette.black,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    elevated: {
      shadowColor: palette.black,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 16,
      elevation: 8,
    },
  },
};
