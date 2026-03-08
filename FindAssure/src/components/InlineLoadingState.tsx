import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useAppTheme } from '../context/ThemeContext';

interface InlineLoadingStateProps {
  label?: string;
  style?: ViewStyle;
}

export const InlineLoadingState: React.FC<InlineLoadingStateProps> = ({
  label = 'Loading…',
  style,
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.container, style]}>
      <ActivityIndicator size="small" color={theme.colors.accent} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    label: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
  });
