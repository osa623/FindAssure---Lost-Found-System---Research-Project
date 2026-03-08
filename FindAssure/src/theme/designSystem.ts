import { DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationDefaultTheme } from '@react-navigation/native';
import { Platform, TextStyle, ViewStyle } from 'react-native';

const ios = Platform.OS === 'ios';

export type ThemeMode = 'light' | 'dark';
export type ThemePreference = 'system' | ThemeMode;

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

type Palette = {
  mode: ThemeMode;
  background: string;
  backgroundMuted: string;
  backgroundElevated: string;
  card: string;
  cardMuted: string;
  input: string;
  inputMuted: string;
  header: string;
  headerMuted: string;
  text: string;
  textStrong: string;
  textMuted: string;
  textSubtle: string;
  placeholder: string;
  border: string;
  borderStrong: string;
  overlay: string;
  accent: string;
  accentDeep: string;
  accentSoft: string;
  accentMuted: string;
  accentText: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  shadow: string;
  shadowMuted: string;
  inverse: string;
  paper: string;
  paperStrong: string;
  shell: string;
  shellAlt: string;
  line: string;
  lineStrong: string;
  ink: string;
  inkSoft: string;
  mist: string;
  primary: string;
  primaryDeep: string;
  primarySoft: string;
  glass: string;
  glassStrong: string;
  glassDark: string;
};

const lightPalette: Palette = {
  mode: 'light' as const,
  background: '#F2F2F7',
  backgroundMuted: '#F7F8FA',
  backgroundElevated: '#EEF1F5',
  card: '#FFFFFF',
  cardMuted: '#F7F8FA',
  input: '#FFFFFF',
  inputMuted: '#F3F4F6',
  header: '#F7F8FA',
  headerMuted: '#EEF1F5',
  text: '#111827',
  textStrong: '#0F172A',
  textMuted: '#64748B',
  textSubtle: '#6B7280',
  placeholder: '#667085',
  border: 'rgba(60, 60, 67, 0.12)',
  borderStrong: 'rgba(60, 60, 67, 0.18)',
  overlay: 'rgba(15, 23, 42, 0.18)',
  accent: '#007AFF',
  accentDeep: '#005FCC',
  accentSoft: '#EAF3FF',
  accentMuted: '#DCEBFF',
  accentText: '#004799',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  warning: '#D97706',
  warningSoft: '#FEF3C7',
  danger: '#D92D20',
  dangerSoft: '#FEE2E2',
  shadow: '#0F172A',
  shadowMuted: 'rgba(15, 23, 42, 0.06)',
  inverse: '#FFFFFF',
  paper: '#F2F2F7',
  paperStrong: '#FFFFFF',
  shell: '#F7F8FA',
  shellAlt: '#EEF1F5',
  line: 'rgba(60, 60, 67, 0.12)',
  lineStrong: 'rgba(60, 60, 67, 0.18)',
  ink: '#111827',
  inkSoft: '#334155',
  mist: '#6B7280',
  primary: '#007AFF',
  primaryDeep: '#005FCC',
  primarySoft: '#EAF3FF',
  glass: 'rgba(255,255,255,0.94)',
  glassStrong: '#FFFFFF',
  glassDark: 'rgba(17,24,39,0.06)',
};

const darkPalette: Palette = {
  mode: 'dark' as const,
  background: '#0E1117',
  backgroundMuted: '#141923',
  backgroundElevated: '#1A2230',
  card: '#151B26',
  cardMuted: '#111722',
  input: '#1A2230',
  inputMuted: '#202B3B',
  header: '#111722',
  headerMuted: '#1A2230',
  text: '#F5F7FB',
  textStrong: '#FFFFFF',
  textMuted: '#CBD5E1',
  textSubtle: '#94A3B8',
  placeholder: '#94A3B8',
  border: 'rgba(148, 163, 184, 0.18)',
  borderStrong: 'rgba(148, 163, 184, 0.3)',
  overlay: 'rgba(2, 6, 23, 0.62)',
  accent: '#4C9BFF',
  accentDeep: '#7DB7FF',
  accentSoft: 'rgba(76, 155, 255, 0.18)',
  accentMuted: 'rgba(76, 155, 255, 0.1)',
  accentText: '#D8EAFF',
  success: '#34D399',
  successSoft: 'rgba(52, 211, 153, 0.18)',
  warning: '#F59E0B',
  warningSoft: 'rgba(245, 158, 11, 0.18)',
  danger: '#F87171',
  dangerSoft: 'rgba(248, 113, 113, 0.18)',
  shadow: '#000000',
  shadowMuted: 'rgba(0, 0, 0, 0.35)',
  inverse: '#08111F',
  paper: '#0E1117',
  paperStrong: '#151B26',
  shell: '#141923',
  shellAlt: '#1A2230',
  line: 'rgba(148, 163, 184, 0.18)',
  lineStrong: 'rgba(148, 163, 184, 0.3)',
  ink: '#F5F7FB',
  inkSoft: '#CBD5E1',
  mist: '#94A3B8',
  primary: '#4C9BFF',
  primaryDeep: '#7DB7FF',
  primarySoft: 'rgba(76, 155, 255, 0.18)',
  glass: 'rgba(21,27,38,0.92)',
  glassStrong: '#151B26',
  glassDark: 'rgba(0,0,0,0.24)',
};

const createShadows = (palette: Palette) => ({
  floating: {
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: ios ? (palette.mode === 'dark' ? 0.28 : 0.08) : 0.08,
    shadowRadius: palette.mode === 'dark' ? 24 : 18,
    elevation: palette.mode === 'dark' ? 8 : 5,
  } satisfies ViewStyle,
  soft: {
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: ios ? (palette.mode === 'dark' ? 0.2 : 0.05) : 0.05,
    shadowRadius: palette.mode === 'dark' ? 16 : 12,
    elevation: palette.mode === 'dark' ? 4 : 2,
  } satisfies ViewStyle,
});

const createGradients = (palette: Palette) => ({
  appBackground:
    palette.mode === 'dark'
      ? (['#0B1018', '#111722', '#0E1117'] as const)
      : (['#F7F8FB', '#F2F4F8', '#F7F8FB'] as const),
  hero:
    palette.mode === 'dark'
      ? (['#143A73', '#1C5BB5', '#3C84E6'] as const)
      : (['#0E5ADB', '#3882F2', '#71B7FF'] as const),
  heroAlt:
    palette.mode === 'dark'
      ? (['#15345E', '#2A5D95', '#4897D8'] as const)
      : (['#1C64E7', '#4C8DFE', '#8EC6FF'] as const),
  success:
    palette.mode === 'dark'
      ? (['#146B4A', '#1B9C57', '#41C27F'] as const)
      : (['#1B9C57', '#4EBC7D', '#7BDAA2'] as const),
  warning:
    palette.mode === 'dark'
      ? (['#9A5A00', '#C77C16', '#E4A645'] as const)
      : (['#D97706', '#E9A74B', '#F1BF72'] as const),
  violet:
    palette.mode === 'dark'
      ? (['#253C77', '#415FB1', '#7696E8'] as const)
      : (['#4D84F0', '#7BA8FA', '#A8C9FF'] as const),
});

const createTypography = (palette: Palette) => ({
  brand: {
    fontFamily: fonts.hero,
    fontSize: 12,
    lineHeight: 15,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: palette.textStrong,
    fontWeight: '700',
  } satisfies TextStyle,
  hero: {
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: -0.5,
    color: palette.textStrong,
    fontWeight: '700',
  } satisfies TextStyle,
  title: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 27,
    letterSpacing: -0.5,
    color: palette.textStrong,
    fontWeight: '700',
  } satisfies TextStyle,
  section: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: -0.2,
    color: palette.textStrong,
    fontWeight: '700',
  } satisfies TextStyle,
  cardTitle: {
    fontFamily: fonts.display,
    fontSize: 15,
    lineHeight: 19,
    letterSpacing: -0.2,
    color: palette.textStrong,
    fontWeight: '600',
  } satisfies TextStyle,
  body: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: palette.textMuted,
  } satisfies TextStyle,
  bodyStrong: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: palette.textStrong,
    fontWeight: '600',
  } satisfies TextStyle,
  label: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: palette.textSubtle,
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
    color: palette.textSubtle,
  } satisfies TextStyle,
});

export const createAppTheme = (mode: ThemeMode) => {
  const colors = mode === 'dark' ? darkPalette : lightPalette;
  const gradients = createGradients(colors);
  const shadows = createShadows(colors);
  const type = createTypography(colors);

  return {
    mode,
    isDark: mode === 'dark',
    colors,
    gradients,
    shadows,
    type,
    spacing,
    radius,
    motion,
    fonts,
    navigationTheme: {
      ...(mode === 'dark' ? NavigationDarkTheme : NavigationDefaultTheme),
      colors: {
        ...(mode === 'dark' ? NavigationDarkTheme.colors : NavigationDefaultTheme.colors),
        background: colors.background,
        card: colors.header,
        border: colors.border,
        text: colors.textStrong,
        primary: colors.accent,
      },
    },
  };
};

export type AppTheme = ReturnType<typeof createAppTheme>;

export const lightTheme = createAppTheme('light');
export const darkTheme = createAppTheme('dark');

export const palette = lightTheme.colors;
export const gradients = lightTheme.gradients;
export const shadows = lightTheme.shadows;
export const type = lightTheme.type;

export const appStyles = {
  screen: {
    flex: 1,
    backgroundColor: palette.background,
  } satisfies ViewStyle,
  screenPadding: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  } satisfies ViewStyle,
};
