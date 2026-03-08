import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { motion, palette, radius, shadows, spacing, type } from '../theme/designSystem';

interface PrimaryButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  icon?: React.ReactNode;
}

export const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  title,
  onPress,
  disabled = false,
  loading = false,
  style,
  textStyle,
  variant = 'primary',
  size = 'md',
  icon,
}) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const variantStyles = getVariantStyles(variant, disabled);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        style={[styles.button, styles[size], variantStyles.container, disabled && styles.buttonDisabled, style]}
        onPress={onPress}
        disabled={disabled || loading}
        onPressIn={() => {
          scale.value = withSpring(0.97, motion.springSoft);
        }}
        onPressOut={() => {
          scale.value = withSpring(1, motion.spring);
        }}
      >
        <View style={styles.content}>
          {loading ? (
            <ActivityIndicator color={variantStyles.text.color} />
          ) : (
            <>
              {icon}
              <Text numberOfLines={1} style={[styles.buttonText, variantStyles.text, textStyle]}>{title}</Text>
            </>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
};

const getVariantStyles = (variant: NonNullable<PrimaryButtonProps['variant']>, disabled: boolean) => {
  if (disabled) {
    return {
      container: {
        backgroundColor: palette.shellAlt,
        borderWidth: 1,
        borderColor: palette.line,
      },
      text: {
        color: palette.mist,
      } as TextStyle,
    };
  }

  switch (variant) {
    case 'secondary':
      return {
        container: {
          borderWidth: 1,
          borderColor: palette.lineStrong,
          backgroundColor: palette.paperStrong,
        },
        text: {
          color: palette.ink,
        } as TextStyle,
      };
    case 'ghost':
      return {
        container: {
          backgroundColor: 'transparent',
        },
        text: {
          color: palette.primaryDeep,
        } as TextStyle,
      };
    case 'danger':
      return {
        container: {
          backgroundColor: palette.danger,
        },
        text: {
          color: palette.paperStrong,
        } as TextStyle,
      };
    default:
      return {
        container: {
          backgroundColor: palette.primary,
        },
        text: {
          color: palette.paperStrong,
        } as TextStyle,
      };
  }
};

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.pill,
    justifyContent: 'center',
    ...shadows.soft,
  },
  md: {
    minHeight: 54,
    paddingHorizontal: 16,
  },
  lg: {
    minHeight: 56,
    paddingHorizontal: 18,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  content: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  buttonText: {
    ...type.button,
  },
});
