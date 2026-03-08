import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AnimatedHeroIllustration } from './AnimatedHeroIllustration';
import { StaggeredEntrance } from './StaggeredEntrance';
import { useAppTheme } from '../context/ThemeContext';
import { GlassCard } from './GlassCard';

interface LoadingScreenProps {
  message?: string;
  subtitle?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  message = 'Loading…',
  subtitle,
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <LinearGradient colors={theme.gradients.appBackground} style={styles.container}>
      <View style={styles.content}>
        <StaggeredEntrance>
          <GlassCard style={styles.card}>
            <View style={styles.iconContainer}>
              <AnimatedHeroIllustration size={104} variant="auth" />
            </View>
            <Text style={styles.appName}>FindAssure</Text>
            <ActivityIndicator size="large" color={theme.colors.accent} style={styles.loader} />
            <Text style={styles.message}>{message}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </GlassCard>
        </StaggeredEntrance>
      </View>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    content: {
      width: '100%',
      paddingHorizontal: 24,
    },
    card: {
      borderRadius: 32,
    },
    iconContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: theme.colors.cardMuted,
      alignSelf: 'center',
      marginBottom: theme.spacing.lg,
    },
    appName: {
      ...theme.type.brand,
      color: theme.colors.textStrong,
      textAlign: 'center',
      marginBottom: theme.spacing.xl,
    },
    loader: {
      marginBottom: theme.spacing.lg,
    },
    message: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      textAlign: 'center',
    },
    subtitle: {
      ...theme.type.body,
      marginTop: theme.spacing.sm,
      color: theme.colors.textMuted,
      textAlign: 'center',
    },
  });
