import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useAppTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { RootStackParamList } from '../../types/models';
import { AnimatedHeroIllustration } from '../../components/AnimatedHeroIllustration';
import { FormInput } from '../../components/FormInput';
import { GlassCard } from '../../components/GlassCard';
import { KeyboardAwareFormScreen } from '../../components/KeyboardAwareFormScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StaggeredEntrance } from '../../components/StaggeredEntrance';
import { getAdminPalette } from './adminTheme';

type AdminLoginNavigationProp = StackNavigationProp<RootStackParamList, 'AdminLogin'>;

const AdminLoginScreen = () => {
  const navigation = useNavigation<AdminLoginNavigationProp>();
  const { signIn, signOut, user } = useAuth();
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const adminPalette = useMemo(() => getAdminPalette(theme), [theme]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [awaitingAdminValidation, setAwaitingAdminValidation] = useState(false);

  useEffect(() => {
    if (!user) {
      return;
    }

    if (user.role === 'admin') {
      setAwaitingAdminValidation(false);
      setLoading(false);
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'AdminDashboard' }],
        })
      );
      return;
    }

    if (!awaitingAdminValidation) {
      return;
    }

    setAwaitingAdminValidation(false);
    setLoading(false);
    void signOut();
    showToast({
      title: 'Access denied',
      message: 'This account is active, but it does not have administrator access.',
      variant: 'error',
    });
  }, [awaitingAdminValidation, navigation, showToast, signOut, user]);

  const handleAdminLogin = async () => {
    if (!email || !password) {
      showToast({
        title: 'Missing details',
        message: 'Enter your admin email and password to continue.',
        variant: 'warning',
      });
      return;
    }

    try {
      setLoading(true);
      setAwaitingAdminValidation(true);
      await signIn({ email, password });
    } catch (error: any) {
      setAwaitingAdminValidation(false);
      setLoading(false);
      showToast({
        title: 'Login failed',
        message: error.message || 'We could not verify your administrator credentials.',
        variant: 'error',
      });
    }
  };

  return (
    <LinearGradient colors={theme.gradients.appBackground} style={styles.container}>
      <KeyboardAwareFormScreen contentContainerStyle={styles.scrollContent}>
        <StaggeredEntrance delay={20}>
          <GlassCard style={styles.hero}>
            <View style={styles.heroTopRow}>
              <View style={[styles.heroBadge, { backgroundColor: adminPalette.accentSoft }]}>
                <Text style={[styles.heroBadgeText, { color: adminPalette.accentText }]}>Restricted access</Text>
              </View>
              <AnimatedHeroIllustration size={112} variant="success" />
            </View>
            <Text style={[styles.wordmark, { color: adminPalette.accent }]}>FindAssure Admin</Text>
            <Text style={styles.heroTitle}>Control room access.</Text>
            <Text style={styles.heroBody}>
              Review system activity, moderate user risk, and manage found-item verification from one secure workspace.
            </Text>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={90}>
          <GlassCard style={styles.formCard}>
            <Text style={styles.sectionEyebrow}>Administrator sign-in</Text>
            <Text style={styles.formTitle}>Enter authorized credentials</Text>

            <FormInput
              label="Admin email"
              placeholder="admin@findassure.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              leadingIcon="shield-checkmark-outline"
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

            <GlassCard style={styles.warningShell} intensity={28}>
              <View style={styles.warningRow}>
                <View style={[styles.warningIconWrap, { backgroundColor: adminPalette.accentSoft }]}>
                  <Ionicons name="alert-circle-outline" size={18} color={adminPalette.accent} />
                </View>
                <View style={styles.warningCopy}>
                  <Text style={styles.warningTitle}>Security notice</Text>
                  <Text style={styles.warningText}>
                    Unauthorized access attempts are blocked, logged, and reviewed by system administrators.
                  </Text>
                </View>
              </View>
            </GlassCard>

            <PrimaryButton
              title="Enter Admin Workspace"
              onPress={handleAdminLogin}
              loading={loading}
              size="lg"
              style={StyleSheet.flatten([styles.loginButton, { backgroundColor: adminPalette.accent }])}
            />

            <PrimaryButton
              title="Return to App"
              onPress={() => navigation.goBack()}
              variant="secondary"
              size="lg"
              style={styles.backButton}
            />
          </GlassCard>
        </StaggeredEntrance>
      </KeyboardAwareFormScreen>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    scrollContent: {
      paddingTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
      justifyContent: 'center',
      minHeight: '100%',
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
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
    },
    heroBadgeText: {
      ...theme.type.caption,
      fontWeight: '700',
    },
    wordmark: {
      ...theme.type.brand,
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
    warningShell: {
      marginTop: theme.spacing.lg,
    },
    warningRow: {
      flexDirection: 'row',
      gap: theme.spacing.md,
      alignItems: 'flex-start',
    },
    warningIconWrap: {
      width: 34,
      height: 34,
      borderRadius: 17,
      justifyContent: 'center',
      alignItems: 'center',
    },
    warningCopy: {
      flex: 1,
    },
    warningTitle: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      marginBottom: 2,
    },
    warningText: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
    },
    loginButton: {
      marginTop: theme.spacing.lg,
    },
    backButton: {
      marginTop: theme.spacing.sm,
    },
  });

export default AdminLoginScreen;
