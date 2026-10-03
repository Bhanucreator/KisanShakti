/**
 * KisanShakti Mandi — Design System
 * ─────────────────────────────────
 * Buyer-side commerce app. Palette is AMBER-PRIMARY (Amazon/Zomato/Swiggy
 * family) to differentiate from Upaj's all-green farmer voice. The two
 * apps read as siblings with distinct personalities:
 *   Upaj  = calm forest green (agriculture, nurture, patience)
 *   Mandi = warm amber gold   (commerce, energy, transaction)
 */

export const COLORS = {
  // Brand Ambers — the new "primary" color family for Mandi
  primaryDark:      '#B45309',
  primary:          '#D97706',      // commerce amber — used on CTAs everywhere
  primaryLight:     '#F59E0B',
  primaryBright:    '#FBBF24',
  primaryTint:      '#FEF3C7',
  primaryLightBg:   '#FFFBEB',      // barely-there amber tint — card highlights

  // Accent Colors
  accentAmber:      '#D97706',
  accentAmberBg:    '#FEF3C7',
  accentRed:        '#DC2626',
  accentRedBg:      '#FEE2E2',
  accentBlue:       '#2563EB',
  accentBlueBg:     '#DBEAFE',
  accentGreen:      '#059669',      // reserved for success/verified badges only
  accentGreenBg:    '#D1FAE5',

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
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32,
} as const;

export const RADII = {
  sm: 8, md: 12, lg: 16, xl: 20, pill: 50, circle: 999,
} as const;

export const FONT_SIZES = {
  caption: 10, small: 12, body: 14, bodyLarge: 15, subtitle: 16, title: 20, hero: 28,
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
  one: 4, two: 8, three: 12, four: 16, five: 20, six: 24,
};

export const BottomTabInset = 60;
export const MaxContentWidth = 800;
