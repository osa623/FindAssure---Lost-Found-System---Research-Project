import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useAppTheme } from '../context/ThemeContext';

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
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const variantStyles = getVariantStyles(theme, variant, disabled);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        style={[styles.button, styles[size], variantStyles.container, disabled && styles.buttonDisabled, style]}
        onPress={onPress}
        disabled={disabled || loading}
        onPressIn={() => {
          scale.value = withSpring(0.97, theme.motion.springSoft);
        }}
        onPressOut={() => {
          scale.value = withSpring(1, theme.motion.spring);
        }}
      >
        <View style={styles.content}>
          {loading ? (
            <ActivityIndicator color={variantStyles.text.color} />
          ) : (
            <>
              {icon}
              <Text numberOfLines={1} style={[styles.buttonText, variantStyles.text, textStyle]}>
                {title}
              </Text>
            </>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
};

const getVariantStyles = (
  theme: ReturnType<typeof useAppTheme>['theme'],
  variant: NonNullable<PrimaryButtonProps['variant']>,
  disabled: boolean
) => {
  if (disabled) {
    return {
      container: {
        backgroundColor: theme.colors.cardMuted,
        borderWidth: 1,
        borderColor: theme.colors.border,
        shadowOpacity: 0,
        elevation: 0,
      },
      text: {
        color: theme.colors.textSubtle,
      } as TextStyle,
    };
  }

  switch (variant) {
    case 'secondary':
      return {
        container: {
          borderWidth: 1,
          borderColor: theme.colors.borderStrong,
          backgroundColor: theme.colors.card,
        },
        text: {
          color: theme.colors.textStrong,
        } as TextStyle,
      };
    case 'ghost':
      return {
        container: {
          backgroundColor: 'transparent',
          shadowOpacity: 0,
          elevation: 0,
        },
        text: {
          color: theme.colors.accent,
        } as TextStyle,
      };
    case 'danger':
      return {
        container: {
          backgroundColor: theme.colors.danger,
        },
        text: {
          color: theme.colors.inverse,
        } as TextStyle,
      };
    default:
      return {
        container: {
          backgroundColor: theme.colors.accent,
        },
        text: {
          color: theme.colors.inverse,
        } as TextStyle,
      };
  }
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    button: {
      borderRadius: theme.radius.pill,
      justifyContent: 'center',
      ...theme.shadows.soft,
    },
    md: {
      minHeight: 52,
      paddingHorizontal: 16,
    },
    lg: {
      minHeight: 56,
      paddingHorizontal: 18,
    },
    buttonDisabled: {
      opacity: 1,
    },
    content: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      columnGap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.xl,
    },
    buttonText: {
      ...theme.type.button,
    },
  });
