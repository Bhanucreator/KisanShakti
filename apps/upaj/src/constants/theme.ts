/**
 * KisanShakti Upaj & Mandi — Design System
 * ─────────────────────────────────────────
 * Clean, high-contrast, modern agricultural design system
 * matching the official UI mockups.
 */

export const COLORS = {
  // Brand Greens
  primaryDark:      '#1B4332',
  primary:          '#2D6A4F',
  primaryLight:     '#40916C',
  primaryBright:    '#52B788',
  primaryTint:      '#D8F3DC',
  primaryLightBg:   '#E8F5E9',

  // Accent Colors
  accentAmber:      '#D97706',
  accentAmberBg:    '#FEF3C7',
  accentRed:        '#DC2626',
  accentRedBg:      '#FEE2E2',
  accentBlue:       '#2563EB',
  accentBlueBg:     '#DBEAFE',

  // Backgrounds & Card Surfaces
  bgApp:            '#F8F9FA',
  bgCard:           '#FFFFFF',
  bgSubtle:         '#F3F4F6',
  bgInput:          '#F9FAFB',

  // Text Colors
  textDark:         '#111827',
  textBody:         '#374151',
  textSecondary:    '#6B7A99',
  textMuted:        '#9CA3AF',
  textWhite:        '#FFFFFF',

  // Borders
  border:           '#E5E7EB',
  borderLight:      '#F3F4F6',
  borderDark:       '#D1D5DB',

  // Shadows
  shadow:           'rgba(0,0,0,0.06)',
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const RADII = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 50,
  circle: 999,
} as const;

export const FONT_SIZES = {
  caption: 10,
  small: 12,
  body: 14,
  bodyLarge: 15,
  subtitle: 16,
  title: 20,
  hero: 28,
} as const;

export const SHADOWS = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  popover: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
} as const;

// ── Legacy & Template Compatibility Exports ────────────────────────────────
export const Fonts = {
  mono: 'monospace',
  sans: 'System',
  rounded: 'System',
};

export const Colors = {
  light: { text: COLORS.textDark, background: COLORS.bgApp, tint: COLORS.primary },
  dark: { text: COLORS.textDark, background: COLORS.bgApp, tint: COLORS.primary },
};

export type ThemeColor = 'text' | 'background' | 'tint';

export const Spacing = {
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 20,
  six: 24,
};

export const BottomTabInset = 60;
export const MaxContentWidth = 800;

// ── Typography (Inter Google Font family names) ────────────────────────────
export const FONTS = {
  regular:   'Inter_400Regular',
  bold:      'Inter_700Bold',
  extraBold: 'Inter_800ExtraBold',
} as const;
