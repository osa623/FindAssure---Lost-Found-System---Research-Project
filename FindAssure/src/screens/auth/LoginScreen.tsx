import { Ionicons } from '@expo/vector-icons';
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

type LoginScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Login'>;

const LoginScreen = () => {
  const navigation = useNavigation<LoginScreenNavigationProp>();
  const { signIn, user } = useAuth();
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [keepLoggedIn, setKeepLoggedIn] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      showToast({
        title: 'Missing details',
        message: 'Please fill in your email and password.',
        variant: 'warning',
      });
      return;
    }

    try {
      setLoading(true);
      await signIn({ email, password, keepLoggedIn });
      showToast({
        title: 'Signed in',
        message: 'Your account is ready to use.',
        variant: 'success',
      });
    } catch (error: any) {
      showToast({
        title: 'Login failed',
        message: error.message || 'Please check your credentials.',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (user && !loading) {
      if (user.role === 'admin') {
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'AdminDashboard' }],
          })
        );
      } else {
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'Home' }],
          })
        );
      }
    }
  }, [user, loading, navigation]);

  return (
    <View style={styles.container}>
      <KeyboardAwareFormScreen contentContainerStyle={styles.scrollContent}>
        <StaggeredEntrance delay={20}>
          <GlassCard style={styles.hero}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>Account access</Text>
              </View>
              <AnimatedHeroIllustration size={112} variant="auth" />
            </View>
            <Text style={styles.wordmark}>FindAssure</Text>
            <Text style={styles.heroTitle}>Welcome back.</Text>
            <Text style={styles.heroBody}>Sign in to search, track claims, and manage your account details.</Text>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={90}>
          <GlassCard style={styles.formCard}>
            <Text style={styles.sectionEyebrow}>Account access</Text>
            <Text style={styles.formTitle}>Sign in</Text>

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
              label="Password"
              placeholder="Enter your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              leadingIcon="lock-closed-outline"
            />

            <Pressable style={styles.inlineRow} onPress={() => setKeepLoggedIn(!keepLoggedIn)}>
              <View style={[styles.toggle, keepLoggedIn && styles.toggleOn]}>
                {keepLoggedIn ? <Ionicons name="checkmark" size={14} color={theme.colors.inverse} /> : null}
              </View>
              <View style={styles.inlineCopy}>
                <Text style={styles.inlineTitle}>Keep me logged in</Text>
                <Text style={styles.inlineBody}>Stay signed in on this device and refresh the session automatically.</Text>
              </View>
            </Pressable>

            <PrimaryButton title="Login" onPress={handleLogin} loading={loading} size="lg" style={styles.buttonGap} />

            <Pressable onPress={() => navigation.navigate('ForgotPassword')} style={styles.linkWrap}>
              <Text style={styles.linkText}>Forgot password?</Text>
            </Pressable>

            <View style={styles.bottomRow}>
              <Text style={styles.bottomText}>Need an account?</Text>
              <Pressable onPress={() => navigation.navigate('Register')}>
                <Text style={styles.linkText}>Register here</Text>
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
    formCard: {
      marginBottom: theme.spacing.md,
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
    inlineRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.md,
      marginTop: theme.spacing.lg,
    },
    toggle: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: theme.colors.borderStrong,
      backgroundColor: theme.colors.card,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 2,
    },
    toggleOn: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    inlineCopy: {
      flex: 1,
    },
    inlineTitle: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      marginBottom: 2,
    },
    inlineBody: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
    },
    buttonGap: {
      marginTop: theme.spacing.lg,
    },
    linkWrap: {
      marginTop: theme.spacing.lg,
      alignSelf: 'center',
    },
    linkText: {
      ...theme.type.bodyStrong,
      color: theme.colors.accent,
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
  });

export default LoginScreen;
