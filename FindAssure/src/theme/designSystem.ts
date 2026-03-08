import { Platform, TextStyle, ViewStyle } from 'react-native';

const ios = Platform.OS === 'ios';

export const palette = {
  ink: '#111827',
  inkSoft: '#334155',
  mist: '#6B7280',
  line: 'rgba(60, 60, 67, 0.12)',
  lineStrong: 'rgba(60, 60, 67, 0.18)',
  frostedLine: 'rgba(60, 60, 67, 0.12)',
  paper: '#F2F2F7',
  paperStrong: '#FFFFFF',
  shell: '#F7F8FA',
  shellAlt: '#EEF1F5',
  glass: 'rgba(255,255,255,0.9)',
  glassStrong: '#FFFFFF',
  glassDark: 'rgba(17,24,39,0.06)',
  primary: '#007AFF',
  primaryDeep: '#005FCC',
  primarySoft: '#EAF3FF',
  cyan: '#B8DFFF',
  teal: '#B8E9D1',
  sky: '#DCEBFF',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  warning: '#D97706',
  warningSoft: '#FEF3C7',
  danger: '#D92D20',
  dangerSoft: '#FEE2E2',
};

export const gradients = {
  appBackground: ['#F7F8FB', '#F2F4F8', '#F7F8FB'] as const,
  hero: ['#1667F2', '#4C8DFE', '#67AAFF'] as const,
  heroAlt: ['#0F5FE2', '#2D7FEF', '#4E9FFF'] as const,
  success: ['#1B9C57', '#4EBC7D', '#7BDAA2'] as const,
  warning: ['#D97706', '#E9A74B', '#F1BF72'] as const,
  violet: ['#4D84F0', '#7BA8FA', '#A8C9FF'] as const,
};

export const spacing = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36,
};

export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 28,
  pill: 999,
};

export const blur = {
  card: ios ? 75 : 28,
  modal: ios ? 95 : 24,
  button: ios ? 55 : 18,
};

export const motion = {
  spring: {
    damping: 18,
    stiffness: 180,
    mass: 0.8,
  },
  springSoft: {
    damping: 20,
    stiffness: 140,
    mass: 0.9,
  },
  duration: {
    fast: 180,
    normal: 320,
    slow: 520,
  },
};

export const shadows = {
  floating: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: ios ? 0.08 : 0.06,
    shadowRadius: 18,
    elevation: 5,
  } satisfies ViewStyle,
  soft: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: ios ? 0.05 : 0.04,
    shadowRadius: 12,
    elevation: 2,
  } satisfies ViewStyle,
};

const fontFamilies = {
  hero: Platform.select({
    ios: 'System',
    android: 'sans-serif-medium',
    default: 'System',
  }),
  display: Platform.select({
    ios: 'System',
    android: 'sans-serif-medium',
    default: 'System',
  }),
  body: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: 'System',
  }),
};

export const fonts = {
  hero: fontFamilies.hero as string,
  display: fontFamilies.display as string,
  body: fontFamilies.body as string,
  requested: {
    hero: 'Monument Extended',
    display: 'Clash Display',
    body: 'Syne',
  },
};

export const type = {
  brand: {
    fontFamily: fonts.hero,
    fontSize: 12,
    lineHeight: 15,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: palette.paperStrong,
    fontWeight: '700',
  } satisfies TextStyle,
  hero: {
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: -0.5,
    color: palette.paperStrong,
    fontWeight: '700',
  } satisfies TextStyle,
  title: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 27,
    letterSpacing: -0.5,
    color: palette.ink,
    fontWeight: '700',
  } satisfies TextStyle,
  section: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: -0.2,
    color: palette.ink,
    fontWeight: '700',
  } satisfies TextStyle,
  cardTitle: {
    fontFamily: fonts.display,
    fontSize: 15,
    lineHeight: 19,
    letterSpacing: -0.2,
    color: palette.ink,
    fontWeight: '600',
  } satisfies TextStyle,
  body: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: palette.inkSoft,
  } satisfies TextStyle,
  bodyStrong: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: palette.ink,
    fontWeight: '600',
  } satisfies TextStyle,
  label: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: palette.mist,
    fontWeight: '700',
  } satisfies TextStyle,
  button: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  } satisfies TextStyle,
  caption: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 15,
    color: palette.mist,
  } satisfies TextStyle,
};

export const appStyles = {
  screen: {
    flex: 1,
    backgroundColor: palette.paper,
  } satisfies ViewStyle,
  screenPadding: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  } satisfies ViewStyle,
};
