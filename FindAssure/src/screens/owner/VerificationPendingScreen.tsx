import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { AnimatedHeroIllustration } from '../../components/AnimatedHeroIllustration';
import { GlassCard } from '../../components/GlassCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StaggeredEntrance } from '../../components/StaggeredEntrance';
import { useAppTheme } from '../../context/ThemeContext';
import { RootStackParamList } from '../../types/models';

type VerificationPendingNavigationProp = StackNavigationProp<RootStackParamList, 'VerificationPending'>;

const VerificationPendingScreen = () => {
  const navigation = useNavigation<VerificationPendingNavigationProp>();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <LinearGradient colors={theme.gradients.appBackground} style={styles.container}>
      <View style={styles.content}>
        <StaggeredEntrance>
          <GlassCard style={styles.hero}>
            <View style={styles.illustrationWrap}>
              <AnimatedHeroIllustration size={128} variant="pending" />
            </View>
            <Text style={styles.heroEyebrow}>Verification pipeline</Text>
            <Text style={styles.heroTitle}>Verification pending.</Text>
            <Text style={styles.heroBody}>
              Your answers are being processed before finder contact details can be revealed.
            </Text>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={90}>
          <GlassCard style={styles.cardGap}>
            <Text style={styles.sectionEyebrow}>What happens next</Text>
            <Text style={styles.sectionBody}>1. Your video answers are processed.</Text>
            <Text style={styles.sectionBody}>2. AI scoring checks semantic and visual consistency.</Text>
            <Text style={styles.sectionBody}>3. If you pass, the finder contact details become available.</Text>
            <Text style={styles.sectionBody}>4. You will be notified about the result.</Text>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={140}>
          <GlassCard style={styles.cardGap}>
            <Text style={styles.sectionEyebrow}>Timing</Text>
            <Text style={styles.sectionBody}>
              This can take a few minutes to a few hours depending on processing and review load.
            </Text>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={180}>
          <PrimaryButton title="Back to Home" onPress={() => navigation.navigate('Home')} size="lg" />
        </StaggeredEntrance>
      </View>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: { flex: 1 },
    content: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.xl,
      paddingBottom: theme.spacing.xl,
    },
    hero: {
      padding: theme.spacing.xl,
      alignItems: 'center',
      marginBottom: theme.spacing.lg,
    },
    illustrationWrap: {
      marginBottom: theme.spacing.md,
    },
    heroEyebrow: {
      ...theme.type.label,
      color: theme.colors.accent,
      marginBottom: theme.spacing.sm,
    },
    heroTitle: {
      ...theme.type.hero,
      color: theme.colors.textStrong,
      textAlign: 'center',
      marginBottom: theme.spacing.sm,
    },
    heroBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      textAlign: 'center',
    },
    cardGap: {
      marginBottom: theme.spacing.lg,
    },
    sectionEyebrow: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    sectionBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.sm,
      textAlign: 'center',
    },
  });

export default VerificationPendingScreen;
