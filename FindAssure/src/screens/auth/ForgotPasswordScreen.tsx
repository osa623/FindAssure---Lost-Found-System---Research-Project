import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AnimatedHeroIllustration } from '../../components/AnimatedHeroIllustration';
import { FormInput } from '../../components/FormInput';
import { GlassCard } from '../../components/GlassCard';
import { KeyboardAwareFormScreen } from '../../components/KeyboardAwareFormScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StaggeredEntrance } from '../../components/StaggeredEntrance';
import { useAuth } from '../../context/AuthContext';
import { useAppTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { RootStackParamList } from '../../types/models';

type ForgotPasswordNavigationProp = StackNavigationProp<RootStackParamList, 'ForgotPassword'>;

const ForgotPasswordScreen = () => {
  const navigation = useNavigation<ForgotPasswordNavigationProp>();
  const { resetPassword } = useAuth();
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleResetPassword = async () => {
    if (!email) {
      showToast({
        title: 'Email required',
        message: 'Please enter your email address.',
        variant: 'warning',
      });
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showToast({
        title: 'Invalid email',
        message: 'Please enter a valid email address.',
        variant: 'warning',
      });
      return;
    }

    try {
      setLoading(true);
      await resetPassword(email);
      setEmailSent(true);
      showToast({
        title: 'Reset email sent',
        message: 'Check your inbox and spam folder for the reset link.',
        variant: 'success',
      });
      navigation.goBack();
    } catch (error: any) {
      showToast({
        title: 'Reset failed',
        message: error.message || 'Failed to send password reset email.',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAwareFormScreen contentContainerStyle={styles.scrollContent}>
        <StaggeredEntrance delay={20}>
          <GlassCard style={styles.hero}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>Recovery</Text>
              </View>
              <AnimatedHeroIllustration size={112} variant="pending" />
            </View>
            <Text style={styles.wordmark}>FindAssure</Text>
            <Text style={styles.heroTitle}>Reset your password.</Text>
            <Text style={styles.heroBody}>Enter the email tied to your account and we will send you a reset link.</Text>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={90}>
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
        </StaggeredEntrance>

        <StaggeredEntrance delay={140}>
          <GlassCard>
            <Text style={styles.sectionEyebrow}>Next steps</Text>
            <Text style={styles.formTitle}>What happens after sending it</Text>
            <Text style={styles.tipText}>1. Check your inbox and spam folder.</Text>
            <Text style={styles.tipText}>2. Open the reset email from Firebase authentication.</Text>
            <Text style={styles.tipText}>3. Set a new password, then return to the app.</Text>
            <Text style={styles.tipText}>4. Sign back in with the updated password.</Text>
          </GlassCard>
        </StaggeredEntrance>
      </KeyboardAwareFormScreen>
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollContent: {
      paddingTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
      gap: theme.spacing.md,
    },
    hero: {
      padding: theme.spacing.lg,
    },
    heroTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: theme.spacing.md,
    },
    heroBadge: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.accentSoft,
      borderRadius: 999,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
    },
    heroBadgeText: {
      ...theme.type.caption,
      color: theme.colors.accent,
      fontWeight: '700',
    },
    wordmark: {
      ...theme.type.brand,
      color: theme.colors.accent,
      marginBottom: theme.spacing.sm,
    },
    heroTitle: {
      ...theme.type.title,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.sm,
    },
    heroBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    formCard: {
      marginTop: 0,
    },
    sectionEyebrow: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    formTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.lg,
    },
    buttonGap: {
      marginTop: theme.spacing.lg,
    },
    backWrap: {
      marginTop: theme.spacing.lg,
      alignSelf: 'center',
    },
    linkText: {
      ...theme.type.bodyStrong,
      color: theme.colors.accent,
    },
    tipText: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.sm,
    },
  });

export default ForgotPasswordScreen;
