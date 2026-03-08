import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useAppTheme } from '../context/ThemeContext';

interface GlassCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  intensity?: number;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  style,
  contentStyle,
  intensity,
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const softened = typeof intensity === 'number' && intensity < 40;

  return (
    <View style={[styles.shell, softened && styles.softShell, style]}>
      <View style={[styles.inner, contentStyle]}>{children}</View>
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    shell: {
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      ...theme.shadows.soft,
    },
    softShell: {
      backgroundColor: theme.colors.cardMuted,
    },
    inner: {
      padding: 14,
      backgroundColor: 'transparent',
    },
  });
