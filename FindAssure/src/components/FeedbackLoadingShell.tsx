import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useAppTheme } from '../context/ThemeContext';
import { AnimatedHeroIllustration } from './AnimatedHeroIllustration';
import { GlassCard } from './GlassCard';
import { StaggeredEntrance } from './StaggeredEntrance';

type LoadingShellMode = 'screen' | 'overlay' | 'inline';

interface FeedbackLoadingShellProps {
  mode: LoadingShellMode;
  badge?: string;
  title: string;
  message?: string;
  stageLabel?: string;
  note?: string;
  illustrationVariant?: 'auth' | 'pending' | 'success';
  style?: StyleProp<ViewStyle>;
}

export const FeedbackLoadingShell: React.FC<FeedbackLoadingShellProps> = ({
  mode,
  badge,
  title,
  message,
  stageLabel,
  note,
  illustrationVariant = 'pending',
  style,
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (mode === 'inline') {
    return (
      <View style={[styles.inlineWrap, style]}>
        <View style={styles.inlineSpinnerWrap}>
          <ActivityIndicator size="small" color={theme.colors.accent} />
        </View>
        <View style={styles.inlineCopy}>
          <Text style={styles.inlineTitle}>{title}</Text>
          {message ? <Text style={styles.inlineMessage}>{message}</Text> : null}
        </View>
      </View>
    );
  }

  const card = (
    <GlassCard style={[mode === 'screen' ? styles.screenCard : styles.overlayCard, style]}>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}

      <View style={styles.illustrationWrap}>
        <AnimatedHeroIllustration size={mode === 'screen' ? 108 : 92} variant={illustrationVariant} />
      </View>

      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {stageLabel ? (
        <View style={styles.stagePill}>
          <View style={styles.stageDot} />
          <Text style={styles.stageText}>{stageLabel}</Text>
        </View>
      ) : null}

      {note ? (
        <View style={styles.noteBox}>
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ) : null}
    </GlassCard>
  );

  if (mode === 'screen') {
    return (
      <LinearGradient colors={theme.gradients.appBackground} style={styles.screenWrap}>
        <View style={styles.screenContent}>
          <StaggeredEntrance>{card}</StaggeredEntrance>
        </View>
      </LinearGradient>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)} style={styles.overlayWrap}>
      {card}
    </Animated.View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    screenWrap: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    screenContent: {
      width: '100%',
      paddingHorizontal: 24,
    },
    screenCard: {
      borderRadius: 32,
    },
    overlayWrap: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.overlay,
      paddingHorizontal: theme.spacing.xl,
      zIndex: 50,
    },
    overlayCard: {
      width: '100%',
      maxWidth: 360,
    },
    badge: {
      alignSelf: 'center',
      marginBottom: theme.spacing.md,
      backgroundColor: theme.colors.accentSoft,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
    },
    badgeText: {
      ...theme.type.caption,
      color: theme.colors.accent,
      fontWeight: '700',
    },
    illustrationWrap: {
      alignItems: 'center',
      marginBottom: theme.spacing.lg,
    },
    title: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      textAlign: 'center',
    },
    message: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      textAlign: 'center',
      marginTop: theme.spacing.sm,
    },
    stagePill: {
      alignSelf: 'center',
      marginTop: theme.spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.cardMuted,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
    },
    stageDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.accent,
    },
    stageText: {
      ...theme.type.caption,
      color: theme.colors.textStrong,
      fontWeight: '700',
    },
    noteBox: {
      marginTop: theme.spacing.lg,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.cardMuted,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    noteText: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      textAlign: 'center',
    },
    inlineWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.md,
    },
    inlineSpinnerWrap: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: theme.colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inlineCopy: {
      flexShrink: 1,
    },
    inlineTitle: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
    },
    inlineMessage: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      marginTop: 1,
    },
  });
