import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useAppTheme } from '../context/ThemeContext';

interface OverlayLoadingStateProps {
  visible: boolean;
  title?: string;
  message?: string;
}

export const OverlayLoadingState: React.FC<OverlayLoadingStateProps> = ({
  visible,
  title = 'Working on it',
  message = 'This usually takes a moment.',
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!visible) {
    return null;
  }

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)} style={styles.overlay}>
      <View style={styles.card}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
      </View>
    </Animated.View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.overlay,
      paddingHorizontal: theme.spacing.xl,
      zIndex: 50,
    },
    card: {
      width: '100%',
      maxWidth: 320,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      paddingHorizontal: theme.spacing.xl,
      paddingVertical: theme.spacing.lg,
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    title: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginTop: theme.spacing.sm,
      textAlign: 'center',
    },
    message: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      textAlign: 'center',
    },
  });
