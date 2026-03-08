import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '../context/ThemeContext';

type IllustrationVariant = 'auth' | 'pending' | 'success';

interface AnimatedHeroIllustrationProps {
  size?: number;
  variant?: IllustrationVariant;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedView = Animated.createAnimatedComponent(View);

const getVariantAccent = (theme: ReturnType<typeof useAppTheme>['theme'], variant: IllustrationVariant) => {
  switch (variant) {
    case 'pending':
      return {
        primary: theme.gradients.violet[1],
        soft: theme.colors.accentSoft,
      };
    case 'success':
      return {
        primary: theme.colors.success,
        soft: theme.colors.successSoft,
      };
    default:
      return {
        primary: theme.colors.accent,
        soft: theme.colors.accentSoft,
      };
  }
};

export const AnimatedHeroIllustration: React.FC<AnimatedHeroIllustrationProps> = ({
  size = 148,
  variant = 'auth',
}) => {
  const { theme } = useAppTheme();
  const colors = getVariantAccent(theme, variant);
  const pulse = useSharedValue(0);
  const orbit = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, {
        duration: 2600,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      false
    );
    orbit.value = withRepeat(
      withTiming(1, {
        duration: 5200,
        easing: Easing.linear,
      }),
      -1,
      false
    );
  }, [orbit, pulse]);

  const ringOneProps = useAnimatedProps(() => ({
    r: 34 + pulse.value * 16,
    opacity: 0.4 - pulse.value * 0.28,
  }));

  const ringTwoProps = useAnimatedProps(() => ({
    r: 44 + pulse.value * 20,
    opacity: 0.22 - pulse.value * 0.14,
  }));

  const orbStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${orbit.value * 360}deg` },
      { translateX: 16 },
      { rotate: `${orbit.value * -360}deg` },
    ],
  }));

  const innerOrbStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${orbit.value * -300}deg` },
      { translateX: -12 },
      { rotate: `${orbit.value * 300}deg` },
    ],
  }));

  const styles = useMemo(() => createStyles(theme, size, colors.soft), [colors.soft, size, theme]);
  const center = size / 2;

  return (
    <View style={styles.container}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <SvgLinearGradient id="heroGlow" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={colors.primary} stopOpacity="0.9" />
            <Stop offset="100%" stopColor={theme.colors.accentDeep} stopOpacity="0.5" />
          </SvgLinearGradient>
        </Defs>

        <Circle cx={center} cy={center} r={size * 0.34} fill={colors.soft} opacity={0.95} />
        <AnimatedCircle animatedProps={ringTwoProps} cx={center} cy={center} stroke={colors.primary} strokeWidth="1.5" fill="none" />
        <AnimatedCircle animatedProps={ringOneProps} cx={center} cy={center} stroke={colors.primary} strokeWidth="2.2" fill="none" />
        <Circle cx={center} cy={center} r={size * 0.18} fill="url(#heroGlow)" />
        <Path
          d={`M ${center - 14} ${center} L ${center - 3} ${center + 11} L ${center + 16} ${center - 10}`}
          stroke={theme.colors.inverse}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={variant === 'pending' ? 0.7 : 1}
        />
      </Svg>

      <AnimatedView style={[styles.orb, styles.outerOrb, orbStyle]} />
      <AnimatedView style={[styles.orb, styles.innerOrb, innerOrbStyle]} />
    </View>
  );
};

const createStyles = (
  theme: ReturnType<typeof useAppTheme>['theme'],
  size: number,
  softColor: string
) =>
  StyleSheet.create({
    container: {
      width: size,
      height: size,
      alignItems: 'center',
      justifyContent: 'center',
    },
    orb: {
      position: 'absolute',
      borderRadius: 999,
      backgroundColor: softColor,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
    },
    outerOrb: {
      width: 18,
      height: 18,
      top: size * 0.15,
      right: size * 0.14,
    },
    innerOrb: {
      width: 12,
      height: 12,
      bottom: size * 0.18,
      left: size * 0.16,
    },
  });
