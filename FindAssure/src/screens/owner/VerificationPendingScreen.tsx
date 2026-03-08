import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { GlassCard } from '../../components/GlassCard';
import { gradients, palette, radius, spacing, type } from '../../theme/designSystem';

type VerificationPendingNavigationProp = StackNavigationProp<RootStackParamList, 'VerificationPending'>;

const VerificationPendingScreen = () => {
  const navigation = useNavigation<VerificationPendingNavigationProp>();

  return (
    <LinearGradient colors={gradients.appBackground} style={styles.container}>
      <View style={styles.content}>
        <LinearGradient colors={gradients.violet} style={styles.hero}>
          <Text style={styles.icon}>◎</Text>
          <Text style={styles.heroTitle}>Verification pending.</Text>
          <Text style={styles.heroBody}>Your answers are in the review pipeline and will be processed before finder contact details are revealed.</Text>
        </LinearGradient>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>What happens next</Text>
          <Text style={styles.sectionBody}>1. Your video answers are processed.</Text>
          <Text style={styles.sectionBody}>2. AI scoring checks semantic and visual consistency.</Text>
          <Text style={styles.sectionBody}>3. If you pass, the finder contact details become available.</Text>
          <Text style={styles.sectionBody}>4. You will be notified about the result.</Text>
        </GlassCard>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Timing</Text>
          <Text style={styles.sectionBody}>This can take a few minutes to a few hours depending on processing and review load.</Text>
        </GlassCard>

        <PrimaryButton title="Back to Home" onPress={() => navigation.navigate('Home')} size="lg" />
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  hero: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  icon: {
    ...type.hero,
    color: palette.paperStrong,
    marginBottom: spacing.sm,
  },
  heroTitle: {
    ...type.hero,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  heroBody: {
    ...type.body,
    color: 'rgba(255,255,255,0.82)',
    textAlign: 'center',
  },
  cardGap: {
    marginBottom: spacing.lg,
  },
  sectionEyebrow: {
    ...type.label,
    marginBottom: spacing.xs,
  },
  sectionBody: {
    ...type.body,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
});

export default VerificationPendingScreen;
