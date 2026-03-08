import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { GlassCard } from '../../components/GlassCard';
import { gradients, palette, radius, spacing, type } from '../../theme/designSystem';

type ReportFoundSuccessNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundSuccess'>;

const ReportFoundSuccessScreen = () => {
  const navigation = useNavigation<ReportFoundSuccessNavigationProp>();

  return (
    <LinearGradient colors={gradients.appBackground} style={styles.container}>
      <View style={styles.content}>
        <LinearGradient colors={gradients.success} style={styles.hero}>
          <Text style={styles.icon}>✓</Text>
          <Text style={styles.heroTitle}>Report submitted.</Text>
          <Text style={styles.heroBody}>The item is now ready for owner search and verification.</Text>
        </LinearGradient>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>What happens next</Text>
          <Text style={styles.sectionTitle}>Owners must prove ownership first</Text>
          <Text style={styles.sectionBody}>Your contact details stay private until the claimant answers your verification prompts successfully.</Text>
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
    color: 'rgba(255,255,255,0.84)',
    textAlign: 'center',
  },
  cardGap: {
    marginBottom: spacing.lg,
  },
  sectionEyebrow: {
    ...type.label,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    ...type.section,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  sectionBody: {
    ...type.body,
    textAlign: 'center',
  },
});

export default ReportFoundSuccessScreen;
