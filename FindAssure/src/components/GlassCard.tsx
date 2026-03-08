import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { palette, radius, shadows } from '../theme/designSystem';

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
  const softened = typeof intensity === 'number' && intensity < 40;

  return (
    <View style={[styles.shell, softened && styles.softShell, style]}>
      <View style={[styles.inner, contentStyle]}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  shell: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.paperStrong,
    ...shadows.soft,
  },
  softShell: {
    backgroundColor: palette.shell,
  },
  inner: {
    padding: 14,
    backgroundColor: 'transparent',
  },
});
