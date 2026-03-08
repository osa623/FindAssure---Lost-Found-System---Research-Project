import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassCard } from './GlassCard';
import { gradients, palette, spacing, type } from '../theme/designSystem';

interface LoadingScreenProps {
  message?: string;
  subtitle?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  message = 'Loading...',
  subtitle,
}) => {
  return (
    <LinearGradient
      colors={gradients.heroAlt}
      style={styles.container}
    >
      <View style={styles.content}>
        <GlassCard style={styles.card}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>⌾</Text>
          </View>
          <Text style={styles.appName}>FIND ASSURE</Text>
          <ActivityIndicator size="large" color={palette.primaryDeep} style={styles.loader} />
          <Text style={styles.message}>{message}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </GlassCard>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
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
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: palette.primarySoft,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  icon: {
    fontSize: 40,
    color: palette.primaryDeep,
  },
  appName: {
    ...type.brand,
    color: palette.ink,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  loader: {
    marginBottom: spacing.lg,
  },
  message: {
    ...type.section,
    textAlign: 'center',
  },
  subtitle: {
    ...type.body,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
