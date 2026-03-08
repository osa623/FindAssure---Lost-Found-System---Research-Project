import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
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
    marginBottom: spacing.xl,
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
});

export default ReportFoundSuccessScreen;
