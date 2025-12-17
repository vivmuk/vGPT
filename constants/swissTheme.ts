import { Platform } from 'react-native';

/**
 * Swiss Modern Design System
 * Based on minimalism, precision, typography, and generous whitespace
 */

export const swissTheme = {
  colors: {
    // Grayscale Foundation
    gray: {
      0: '#FFFFFF',     // Pure white
      50: '#FAFAFA',    // Lightest
      100: '#F5F5F5',   // Very light
      200: '#E5E5E5',   // Light
      300: '#D4D4D4',   // Medium light
      400: '#A3A3A3',   // Medium
      500: '#737373',   // Medium dark
      600: '#525252',   // Dark
      700: '#404040',   // Darker
      800: '#262626',   // Very dark
      900: '#171717',   // Almost black
      950: '#0A0A0A',   // Deepest
    },
    black: '#000000',
    white: '#FFFFFF',

    // Accent: Swiss Blue
    accent: {
      primary: '#0066CC',  // Swiss blue (accent color)
      light: '#E6F0FA',    // Light tint (backgrounds)
      dark: '#004C99',     // Dark shade (hover/active)
    },

    // Functional Colors
    success: '#059669',    // Green
    warning: '#D97706',    // Amber/Orange
    error: '#DC2626',      // Red

    // Semantic Aliases
    background: '#FFFFFF',
    surface: '#FAFAFA',
    border: '#E5E5E5',
    text: {
      primary: '#171717',      // gray-900
      secondary: '#525252',    // gray-600
      tertiary: '#A3A3A3',     // gray-400
      inverted: '#FFFFFF',     // white
    },
  },

  typography: {
    fontFamily: {
      primary: Platform.select({
        ios: 'SF Pro Display',
        android: 'Roboto',
        web: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      }),
      mono: Platform.select({
        ios: 'SF Mono',
        android: 'Roboto Mono',
        web: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
      }),
    },

    fontSize: {
      xs: 12,    // Small labels, secondary text
      sm: 14,    // Small text, descriptions
      base: 16,  // Body text (default)
      lg: 18,    // Emphasis, slightly larger body
      xl: 20,    // Subheadings
      xxl: 24,   // Headings
      xxxl: 32,  // Hero text, large headings
    },

    fontWeight: {
      regular: '400' as const,
      medium: '500' as const,
      semibold: '600' as const,
    },

    lineHeight: {
      tight: 1.25,   // 20px for 16px text
      normal: 1.5,   // 24px for 16px text (readable)
      relaxed: 1.75, // 28px for 16px text
    },

    letterSpacing: {
      tight: -0.5,
      normal: 0,
      wide: 0.5,
    },
  },

  // 8pt Baseline Grid
  spacing: {
    0: 0,
    1: 4,    // 0.5 unit
    2: 8,    // 1 unit (base)
    3: 12,   // 1.5 units
    4: 16,   // 2 units
    5: 20,   // 2.5 units
    6: 24,   // 3 units
    7: 28,   // 3.5 units
    8: 32,   // 4 units
    10: 40,  // 5 units
    12: 48,  // 6 units
    16: 64,  // 8 units
    20: 80,  // 10 units
    24: 96,  // 12 units
  },

  borders: {
    width: {
      thin: 1,     // Standard Swiss border
      medium: 2,   // Emphasis, selected states
    },
    radius: {
      none: 0,     // Sharp corners (preferred)
      sm: 2,       // Subtle rounding
      md: 4,       // Moderate rounding (default)
      lg: 8,       // Larger rounding (use sparingly)
    },
  },

  shadows: {
    // Minimal shadows - prefer borders for elevation
    subtle: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    elevated: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 4,
      elevation: 2,
    },
  },

  // Z-index layer system
  zIndex: {
    base: 0,
    dropdown: 10,
    sticky: 20,
    fixed: 30,
    modal: 40,
    tooltip: 50,
  },
};

// Type exports for convenience
export type SwissTheme = typeof swissTheme;
export type SwissColor = typeof swissTheme.colors;
export type SwissSpacing = typeof swissTheme.spacing;
export type SwissTypography = typeof swissTheme.typography;
