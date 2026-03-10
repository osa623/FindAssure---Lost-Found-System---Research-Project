import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient as SvgLinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import Animated, {
  interpolate,
  SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useAppTheme } from '../context/ThemeContext';

export type OnboardingIllustrationVariant = 'report' | 'search' | 'verify';

interface OnboardingIllustrationProps {
  variant: OnboardingIllustrationVariant;
  accent?: string;
  index: number;
  pageWidth: number;
  scrollX: SharedValue<number>;
}

type IllustrationPalette = {
  primary: string;
  secondary: string;
  tertiary: string;
  glow: string;
  surface: string;
  surfaceStrong: string;
  line: string;
  chip: string;
  chipText: string;
};

export const OnboardingIllustration: React.FC<OnboardingIllustrationProps> = ({
  variant,
  accent,
  index,
  pageWidth,
  scrollX,
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const palette = useMemo(() => getPalette(theme, variant), [theme, variant]);

  const shellStyle = useAnimatedStyle(() => {
    const position = scrollX.value / pageWidth;
    return {
      opacity: interpolate(position, [index - 1, index, index + 1], [0.72, 1, 0.72]),
      transform: [
        { scale: interpolate(position, [index - 1, index, index + 1], [0.92, 1, 0.92]) },
      ],
    };
  });

  const glowStyle = useAnimatedStyle(() => {
    const position = scrollX.value / pageWidth;
    return {
      transform: [
        { translateX: interpolate(position, [index - 1, index, index + 1], [-26, 0, 26]) },
        { translateY: interpolate(position, [index - 1, index, index + 1], [18, 0, 18]) },
        { scale: interpolate(position, [index - 1, index, index + 1], [0.84, 1, 0.84]) },
      ],
    };
  });

  const mainCardStyle = useAnimatedStyle(() => {
    const position = scrollX.value / pageWidth;
    return {
      transform: [
        { translateX: interpolate(position, [index - 1, index, index + 1], [18, 0, -18]) },
        { translateY: interpolate(position, [index - 1, index, index + 1], [12, 0, 12]) },
      ],
    };
  });

  const floatingCardStyle = useAnimatedStyle(() => {
    const position = scrollX.value / pageWidth;
    return {
      opacity: interpolate(position, [index - 1, index, index + 1], [0.35, 1, 0.35]),
      transform: [
        { translateX: interpolate(position, [index - 1, index, index + 1], [-24, 0, 24]) },
        { translateY: interpolate(position, [index - 1, index, index + 1], [-10, 0, -10]) },
      ],
    };
  });

  const detailCardStyle = useAnimatedStyle(() => {
    const position = scrollX.value / pageWidth;
    return {
      opacity: interpolate(position, [index - 1, index, index + 1], [0.2, 1, 0.2]),
      transform: [
        { translateX: interpolate(position, [index - 1, index, index + 1], [22, 0, -22]) },
        { translateY: interpolate(position, [index - 1, index, index + 1], [10, 0, 10]) },
      ],
    };
  });

  return (
    <Animated.View style={[styles.canvasShell, shellStyle]}>
      <Animated.View style={[styles.glowLayer, glowStyle]}>
        <Svg width="100%" height="100%" viewBox="0 0 320 280" fill="none">
          <Defs>
            <SvgLinearGradient id={`bg-${variant}`} x1="20" y1="0" x2="280" y2="280">
              <Stop offset="0" stopColor={palette.primary} stopOpacity="0.92" />
              <Stop offset="1" stopColor={palette.secondary} stopOpacity="0.5" />
            </SvgLinearGradient>
            <SvgLinearGradient id={`orb-${variant}`} x1="40" y1="40" x2="200" y2="220">
              <Stop offset="0" stopColor={palette.glow} stopOpacity="0.95" />
              <Stop offset="1" stopColor={palette.primary} stopOpacity="0.16" />
            </SvgLinearGradient>
          </Defs>
          <Rect x="10" y="10" width="300" height="260" rx="40" fill={theme.colors.tintSurface} />
          <Circle cx="92" cy="98" r="76" fill={`url(#orb-${variant})`} />
          <Circle cx="240" cy="84" r="54" fill={palette.glow} fillOpacity="0.14" />
          <Path
            d="M42 206C95 170 143 188 197 156C224 140 246 106 279 106"
            stroke={`url(#bg-${variant})`}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="7 9"
            opacity="0.54"
          />
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.mainCard, mainCardStyle]}>
        {variant === 'report' ? (
          <ReportVisual palette={palette} />
        ) : variant === 'search' ? (
          <SearchVisual palette={palette} />
        ) : (
          <VerifyVisual palette={palette} />
        )}
      </Animated.View>

      <Animated.View style={[styles.badgeCard, floatingCardStyle]}>
        <View style={[styles.badgeDot, { backgroundColor: palette.primary }]} />
        <View style={styles.badgeCopy}>
          <Text style={[styles.badgeLabel, { color: palette.chipText }]}>
            {accent || getDefaultAccent(variant)}
          </Text>
          <Text style={styles.badgeValue}>{getFloatingLabel(variant)}</Text>
        </View>
      </Animated.View>

      <Animated.View style={[styles.detailCard, detailCardStyle]}>
        <Text style={styles.detailEyebrow}>{getDetailEyebrow(variant)}</Text>
        <Text style={styles.detailValue}>{getDetailValue(variant)}</Text>
        <View style={styles.detailMeter}>
          <View style={[styles.detailMeterFill, { backgroundColor: palette.primary }]} />
        </View>
      </Animated.View>
    </Animated.View>
  );
};

const ReportVisual = ({ palette }: { palette: IllustrationPalette }) => (
  <Svg width="100%" height="100%" viewBox="0 0 280 220" fill="none">
    <Defs>
      <SvgLinearGradient id="report-screen" x1="34" y1="18" x2="210" y2="190">
        <Stop offset="0" stopColor={palette.primary} />
        <Stop offset="1" stopColor={palette.secondary} />
      </SvgLinearGradient>
      <SvgLinearGradient id="report-card" x1="160" y1="116" x2="248" y2="192">
        <Stop offset="0" stopColor={palette.surfaceStrong} />
        <Stop offset="1" stopColor={palette.surface} />
      </SvgLinearGradient>
    </Defs>
    <Rect x="32" y="18" width="146" height="184" rx="34" fill={palette.surfaceStrong} />
    <Rect x="44" y="36" width="122" height="120" rx="24" fill="url(#report-screen)" />
    <Rect x="70" y="48" width="70" height="10" rx="5" fill="rgba(255,255,255,0.28)" />
    <Rect x="58" y="74" width="96" height="54" rx="18" fill="rgba(255,255,255,0.12)" />
    <Path
      d="M68 116L88 98L104 113L126 86L152 120"
      stroke="rgba(255,255,255,0.8)"
      strokeWidth="5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Circle cx="82" cy="88" r="9" fill="rgba(255,255,255,0.8)" />
    <Rect x="58" y="168" width="78" height="8" rx="4" fill="rgba(255,255,255,0.18)" />
    <Rect x="58" y="184" width="56" height="8" rx="4" fill="rgba(255,255,255,0.12)" />

    <Rect x="150" y="126" width="96" height="64" rx="22" fill="url(#report-card)" />
    <Rect x="164" y="142" width="50" height="9" rx="4.5" fill={palette.line} />
    <Rect x="164" y="160" width="68" height="9" rx="4.5" fill={palette.line} opacity="0.76" />
    <Circle cx="223" cy="146" r="14" fill={palette.primary} fillOpacity="0.22" />
    <Path
      d="M216 146.5L221 151L229 141"
      stroke={palette.primary}
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Circle cx="204" cy="38" r="16" fill={palette.chip} />
    <Path
      d="M204 31V45M197 38H211"
      stroke={palette.primary}
      strokeWidth="3.5"
      strokeLinecap="round"
    />
  </Svg>
);

const SearchVisual = ({ palette }: { palette: IllustrationPalette }) => (
  <Svg width="100%" height="100%" viewBox="0 0 280 220" fill="none">
    <Defs>
      <SvgLinearGradient id="search-main" x1="48" y1="22" x2="228" y2="188">
        <Stop offset="0" stopColor={palette.primary} />
        <Stop offset="1" stopColor={palette.secondary} />
      </SvgLinearGradient>
    </Defs>
    <Rect x="40" y="26" width="186" height="156" rx="28" fill={palette.surfaceStrong} />
    <Rect x="56" y="42" width="154" height="28" rx="14" fill={palette.chip} />
    <Circle cx="78" cy="56" r="8" fill={palette.primary} fillOpacity="0.32" />
    <Path
      d="M83 61L88 66"
      stroke={palette.primary}
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <Rect x="100" y="51" width="72" height="10" rx="5" fill={palette.line} />

    <Rect x="56" y="84" width="90" height="82" rx="22" fill="url(#search-main)" />
    <Rect x="156" y="84" width="54" height="26" rx="13" fill={palette.chip} />
    <Rect x="156" y="118" width="54" height="16" rx="8" fill={palette.line} />
    <Rect x="156" y="140" width="42" height="16" rx="8" fill={palette.line} opacity="0.72" />
    <Circle cx="202" cy="182" r="24" fill={palette.primary} fillOpacity="0.15" />
    <Path
      d="M202 167C194.268 167 188 173.268 188 181C188 188.732 194.268 195 202 195C209.732 195 216 188.732 216 181C216 173.268 209.732 167 202 167Z"
      stroke={palette.primary}
      strokeWidth="4"
    />
    <Path
      d="M214 193L226 205"
      stroke={palette.primary}
      strokeWidth="4"
      strokeLinecap="round"
    />
    <Path
      d="M92 98C101.5 98 109 90.5 109 81C109 90.5 116.5 98 126 98C116.5 98 109 105.5 109 115C109 105.5 101.5 98 92 98Z"
      fill="rgba(255,255,255,0.78)"
    />
  </Svg>
);

const VerifyVisual = ({ palette }: { palette: IllustrationPalette }) => (
  <Svg width="100%" height="100%" viewBox="0 0 280 220" fill="none">
    <Defs>
      <SvgLinearGradient id="verify-shield" x1="80" y1="28" x2="156" y2="164">
        <Stop offset="0" stopColor={palette.primary} />
        <Stop offset="1" stopColor={palette.secondary} />
      </SvgLinearGradient>
      <SvgLinearGradient id="verify-card" x1="154" y1="64" x2="248" y2="168">
        <Stop offset="0" stopColor={palette.surfaceStrong} />
        <Stop offset="1" stopColor={palette.surface} />
      </SvgLinearGradient>
    </Defs>
    <Path
      d="M94 28L156 48V102C156 132.954 131.807 158.603 102.121 165.78L96 167.25L89.879 165.78C60.193 158.603 36 132.954 36 102V48L94 28Z"
      fill="url(#verify-shield)"
    />
    <Circle cx="94" cy="91" r="22" fill="rgba(255,255,255,0.16)" />
    <Path
      d="M78 92L89 103L112 80"
      stroke="rgba(255,255,255,0.88)"
      strokeWidth="6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Rect x="146" y="64" width="94" height="80" rx="24" fill="url(#verify-card)" />
    <Rect x="160" y="82" width="48" height="10" rx="5" fill={palette.line} />
    <Rect x="160" y="102" width="62" height="10" rx="5" fill={palette.line} opacity="0.76" />
    <Rect x="160" y="122" width="38" height="10" rx="5" fill={palette.line} opacity="0.58" />
    <Path
      d="M220 86C220 77.163 212.837 70 204 70C195.163 70 188 77.163 188 86V98H220V86Z"
      fill={palette.chip}
    />
    <Rect x="184" y="94" width="40" height="28" rx="12" fill={palette.chip} />
    <Circle cx="204" cy="106" r="6" fill={palette.primary} />
    <Rect x="122" y="158" width="112" height="36" rx="18" fill={palette.chip} />
    <G opacity="0.85">
      <Rect x="136" y="171" width="58" height="8" rx="4" fill={palette.line} />
      <Rect x="200" y="171" width="20" height="8" rx="4" fill={palette.primary} fillOpacity="0.36" />
    </G>
  </Svg>
);

const getPalette = (
  theme: ReturnType<typeof useAppTheme>['theme'],
  variant: OnboardingIllustrationVariant
): IllustrationPalette => {
  switch (variant) {
    case 'search':
      return {
        primary: theme.isDark ? '#58A6FF' : '#236BFE',
        secondary: theme.isDark ? '#8F9BFF' : '#75B7FF',
        tertiary: theme.isDark ? '#98D4FF' : '#A3D6FF',
        glow: theme.isDark ? 'rgba(88,166,255,0.42)' : 'rgba(35,107,254,0.28)',
        surface: theme.isDark ? '#15253D' : '#EAF4FF',
        surfaceStrong: theme.isDark ? '#0E1A2E' : '#FFFFFF',
        line: theme.isDark ? 'rgba(214,228,255,0.7)' : 'rgba(17,24,39,0.16)',
        chip: theme.isDark ? 'rgba(88,166,255,0.16)' : '#E6F0FF',
        chipText: theme.isDark ? '#D7E8FF' : '#1742A4',
      };
    case 'verify':
      return {
        primary: theme.isDark ? '#34D399' : '#13A463',
        secondary: theme.isDark ? '#6EE7B7' : '#4FCF90',
        tertiary: theme.isDark ? '#A7F3D0' : '#9CE2BF',
        glow: theme.isDark ? 'rgba(52,211,153,0.34)' : 'rgba(19,164,99,0.26)',
        surface: theme.isDark ? '#12271F' : '#E9FFF4',
        surfaceStrong: theme.isDark ? '#0D1D17' : '#FFFFFF',
        line: theme.isDark ? 'rgba(217,255,241,0.68)' : 'rgba(17,24,39,0.16)',
        chip: theme.isDark ? 'rgba(52,211,153,0.16)' : '#E0FAEE',
        chipText: theme.isDark ? '#D7FBEF' : '#136846',
      };
    default:
      return {
        primary: theme.isDark ? '#6FB3FF' : '#2563FF',
        secondary: theme.isDark ? '#9B8CFF' : '#74B5FF',
        tertiary: theme.isDark ? '#C4B5FD' : '#C8DBFF',
        glow: theme.isDark ? 'rgba(111,179,255,0.36)' : 'rgba(37,99,255,0.28)',
        surface: theme.isDark ? '#14233D' : '#EAF1FF',
        surfaceStrong: theme.isDark ? '#101B2E' : '#FFFFFF',
        line: theme.isDark ? 'rgba(220,232,255,0.68)' : 'rgba(17,24,39,0.16)',
        chip: theme.isDark ? 'rgba(111,179,255,0.16)' : '#E7EFFF',
        chipText: theme.isDark ? '#DAE9FF' : '#1E46A8',
      };
  }
};

const getFloatingLabel = (variant: OnboardingIllustrationVariant) => {
  switch (variant) {
    case 'search':
      return 'Top match ready';
    case 'verify':
      return 'Identity protected';
    default:
      return 'Guided recovery flow';
  }
};

const getDefaultAccent = (variant: OnboardingIllustrationVariant) => {
  switch (variant) {
    case 'search':
      return 'Signal-first search';
    case 'verify':
      return 'Private release';
    default:
      return 'Camera-led intake';
  }
};

const getDetailEyebrow = (variant: OnboardingIllustrationVariant) => {
  switch (variant) {
    case 'search':
      return 'Recovery score';
    case 'verify':
      return 'Claim gate';
    default:
      return 'Checklist';
  }
};

const getDetailValue = (variant: OnboardingIllustrationVariant) => {
  switch (variant) {
    case 'search':
      return '92% confidence match';
    case 'verify':
      return 'Unlock only after proof';
    default:
      return 'Photos, details, owner-only answers';
  }
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    canvasShell: {
      height: '100%',
      borderRadius: 34,
      overflow: 'hidden',
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.5)',
      borderWidth: 1,
      borderColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.38)',
      ...theme.shadows.floating,
    },
    glowLayer: {
      ...StyleSheet.absoluteFillObject,
    },
    mainCard: {
      position: 'absolute',
      top: 24,
      left: 18,
      right: 18,
      bottom: 18,
      borderRadius: 30,
      overflow: 'hidden',
      backgroundColor: theme.isDark ? 'rgba(7,12,20,0.16)' : 'rgba(255,255,255,0.18)',
    },
    badgeCard: {
      position: 'absolute',
      top: 20,
      right: 18,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 20,
      backgroundColor: theme.colors.glass,
      borderWidth: 1,
      borderColor: theme.colors.border,
      maxWidth: 190,
      ...theme.shadows.soft,
    },
    badgeDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    badgeCopy: {
      flexShrink: 1,
    },
    badgeLabel: {
      ...theme.type.caption,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 2,
    },
    badgeValue: {
      ...theme.type.bodyStrong,
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.textStrong,
    },
    detailCard: {
      position: 'absolute',
      left: 18,
      right: 104,
      bottom: 20,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 22,
      backgroundColor: theme.colors.glass,
      borderWidth: 1,
      borderColor: theme.colors.border,
      ...theme.shadows.soft,
    },
    detailEyebrow: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 4,
    },
    detailValue: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      fontSize: 12,
      lineHeight: 17,
      marginBottom: 10,
    },
    detailMeter: {
      height: 6,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: theme.colors.cardMuted,
    },
    detailMeterFill: {
      width: '72%',
      height: '100%',
      borderRadius: 999,
    },
  });
