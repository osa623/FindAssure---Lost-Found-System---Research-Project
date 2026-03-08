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
import { CommonActions, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { RootStackParamList } from '../../types/models';
import { FormInput } from '../../components/FormInput';
import { GlassCard } from '../../components/GlassCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { gradients, palette, spacing, type } from '../../theme/designSystem';

type LoginScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Login'>;

const LoginScreen = () => {
  const navigation = useNavigation<LoginScreenNavigationProp>();
  const { signIn, user } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [keepLoggedIn, setKeepLoggedIn] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    try {
      setLoading(true);
      await signIn({ email, password, keepLoggedIn });
    } catch (error: any) {
      Alert.alert('Login Failed', error.message || 'Please check your credentials');
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
    <LinearGradient colors={gradients.appBackground} style={styles.container}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <GlassCard style={styles.hero}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Account access</Text>
            </View>
            <Text style={styles.wordmark}>FIND ASSURE</Text>
            <Text style={styles.heroTitle}>Welcome back.</Text>
            <Text style={styles.heroBody}>Sign in to start searching, track claims, and manage your account details.</Text>
          </GlassCard>

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
                {keepLoggedIn ? <Ionicons name="checkmark" size={14} color={palette.paperStrong} /> : null}
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
  },
  hero: {
    borderRadius: 24,
    padding: spacing.lg,
    marginBottom: spacing.lg,
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
    marginBottom: spacing.md,
  },
  sectionEyebrow: {
    ...type.label,
    marginBottom: spacing.xs,
  },
  formTitle: {
    ...type.section,
    marginBottom: spacing.xl,
  },
  fieldGap: {
    marginBottom: spacing.md,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  toggle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: palette.line,
    backgroundColor: palette.paperStrong,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  toggleOn: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },
  inlineCopy: {
    flex: 1,
  },
  inlineTitle: {
    ...type.bodyStrong,
    marginBottom: 2,
  },
  inlineBody: {
    ...type.caption,
  },
  buttonGap: {
    marginTop: spacing.lg,
  },
  linkWrap: {
    marginTop: spacing.lg,
    alignSelf: 'center',
  },
  linkText: {
    ...type.bodyStrong,
    color: palette.primaryDeep,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  bottomText: {
    ...type.body,
  },
});

export default LoginScreen;
