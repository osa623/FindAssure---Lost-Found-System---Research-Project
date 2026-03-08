import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { RootStackParamList } from '../../types/models';
import { FormInput } from '../../components/FormInput';
import { GlassCard } from '../../components/GlassCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { gradients, palette, spacing, type } from '../../theme/designSystem';

type ForgotPasswordNavigationProp = StackNavigationProp<RootStackParamList, 'ForgotPassword'>;

const ForgotPasswordScreen = () => {
  const navigation = useNavigation<ForgotPasswordNavigationProp>();
  const { resetPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleResetPassword = async () => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    try {
      setLoading(true);
      await resetPassword(email);
      setEmailSent(true);
      Alert.alert(
        'Email Sent!',
        'Password reset instructions have been sent to your email address. Please check your inbox (and spam folder).',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to send password reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={gradients.appBackground} style={styles.container}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <GlassCard style={styles.hero}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Recovery</Text>
            </View>
            <Text style={styles.wordmark}>FIND ASSURE</Text>
            <Text style={styles.heroTitle}>Reset your password.</Text>
            <Text style={styles.heroBody}>Enter the email tied to your account and we will send you a reset link.</Text>
          </GlassCard>

          <GlassCard style={styles.formCard}>
            <Text style={styles.sectionEyebrow}>Recovery</Text>
            <Text style={styles.formTitle}>Send reset email</Text>
            <FormInput
              label="Email"
              placeholder="name@example.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              editable={!emailSent}
              leadingIcon="mail-outline"
            />
            <PrimaryButton
              title={emailSent ? 'Email Sent' : 'Send Reset Email'}
              onPress={handleResetPassword}
              loading={loading}
              disabled={emailSent}
              size="lg"
              style={styles.buttonGap}
            />
            <Pressable onPress={() => navigation.goBack()} style={styles.backWrap}>
              <Text style={styles.linkText}>Back to login</Text>
            </Pressable>
          </GlassCard>

          <GlassCard>
            <Text style={styles.sectionEyebrow}>Next steps</Text>
            <Text style={styles.formTitle}>What happens after sending it</Text>
            <Text style={styles.tipText}>1. Check your inbox and spam folder.</Text>
            <Text style={styles.tipText}>2. Open the reset email from Firebase authentication.</Text>
            <Text style={styles.tipText}>3. Set a new password, then return to the app.</Text>
            <Text style={styles.tipText}>4. Sign back in with the updated password.</Text>
          </GlassCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  hero: {
    borderRadius: 24,
    padding: spacing.lg,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: palette.primarySoft,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    marginBottom: spacing.md,
  },
  heroBadgeText: {
    ...type.caption,
    color: palette.primaryDeep,
    fontWeight: '700',
  },
  wordmark: {
    ...type.brand,
    fontSize: 15,
    lineHeight: 17,
    color: palette.primaryDeep,
    marginBottom: spacing.sm,
  },
  heroTitle: {
    ...type.title,
    color: palette.ink,
    marginBottom: spacing.sm,
  },
  heroBody: {
    ...type.body,
    color: palette.inkSoft,
  },
  formCard: {
    marginTop: 0,
  },
  sectionEyebrow: {
    ...type.label,
    marginBottom: spacing.xs,
  },
  formTitle: {
    ...type.section,
    marginBottom: spacing.lg,
  },
  buttonGap: {
    marginTop: spacing.lg,
  },
  backWrap: {
    marginTop: spacing.lg,
    alignSelf: 'center',
  },
  linkText: {
    ...type.bodyStrong,
    color: palette.primaryDeep,
  },
  tipText: {
    ...type.body,
    marginBottom: spacing.sm,
  },
});

export default ForgotPasswordScreen;
