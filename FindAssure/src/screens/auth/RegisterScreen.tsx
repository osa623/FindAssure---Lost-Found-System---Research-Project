import { CommonActions, useNavigation } from '@react-navigation/native';
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

type RegisterScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Register'>;

const RegisterScreen = () => {
  const navigation = useNavigation<RegisterScreenNavigationProp>();
  const { signUp } = useAuth();
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!name || !email || !phone || !password || !confirmPassword) {
      showToast({
        title: 'Missing details',
        message: 'Please fill in all fields.',
        variant: 'warning',
      });
      return;
    }
    if (password !== confirmPassword) {
      showToast({
        title: 'Passwords do not match',
        message: 'Please confirm the same password in both fields.',
        variant: 'warning',
      });
      return;
    }
    if (password.length < 6) {
      showToast({
        title: 'Password too short',
        message: 'Password must be at least 6 characters.',
        variant: 'warning',
      });
      return;
    }

    try {
      setLoading(true);
      await signUp({ name, email, phone, password, role: 'owner' } as any);
      showToast({
        title: 'Account created',
        message: 'Your owner account is ready.',
        variant: 'success',
      });
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'Home' }],
        })
      );
    } catch (error: any) {
      showToast({
        title: 'Registration failed',
        message: error.message || 'Please try again.',
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
                <Text style={styles.heroBadgeText}>Registration</Text>
              </View>
              <AnimatedHeroIllustration size={112} variant="auth" />
            </View>
            <Text style={styles.wordmark}>FindAssure</Text>
            <Text style={styles.heroTitle}>Create an owner account.</Text>
            <Text style={styles.heroBody}>Get access to search, verification history, and future claim tracking.</Text>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={90}>
          <GlassCard>
            <Text style={styles.sectionEyebrow}>Registration</Text>
            <Text style={styles.formTitle}>Personal details</Text>

            <FormInput
              label="Full name"
              placeholder="Enter your full name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              leadingIcon="person-outline"
              containerStyle={styles.fieldGap}
            />
            <FormInput
              label="Email"
              placeholder="name@example.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              leadingIcon="mail-outline"
              containerStyle={styles.fieldGap}
            />
            <FormInput
              label="Phone number"
              placeholder="Enter your phone number"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              leadingIcon="call-outline"
              containerStyle={styles.fieldGap}
            />
            <FormInput
              label="Password"
              placeholder="Minimum 6 characters"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password-new"
              leadingIcon="lock-closed-outline"
              containerStyle={styles.fieldGap}
            />
            <FormInput
              label="Confirm password"
              placeholder="Repeat the password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              leadingIcon="checkmark-circle-outline"
            />

            <PrimaryButton title="Register" onPress={handleRegister} loading={loading} size="lg" style={styles.buttonGap} />

            <View style={styles.bottomRow}>
              <Text style={styles.bottomText}>Already have an account?</Text>
              <Pressable onPress={() => navigation.navigate('Login')}>
                <Text style={styles.linkText}>Login here</Text>
              </Pressable>
            </View>
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
    },
    hero: {
      padding: theme.spacing.lg,
      marginBottom: theme.spacing.md,
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
    sectionEyebrow: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    formTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.lg,
    },
    fieldGap: {
      marginBottom: theme.spacing.md,
    },
    buttonGap: {
      marginTop: theme.spacing.lg,
    },
    bottomRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.lg,
    },
    bottomText: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    linkText: {
      ...theme.type.bodyStrong,
      color: theme.colors.accent,
    },
  });

export default RegisterScreen;
