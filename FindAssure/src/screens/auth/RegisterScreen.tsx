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
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { RootStackParamList } from '../../types/models';
import { FormInput } from '../../components/FormInput';
import { GlassCard } from '../../components/GlassCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { gradients, palette, spacing, type } from '../../theme/designSystem';

type RegisterScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Register'>;

const RegisterScreen = () => {
  const navigation = useNavigation<RegisterScreenNavigationProp>();
  const { signUp } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!name || !email || !phone || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    try {
      setLoading(true);
      await signUp({ name, email, phone, password, role: 'owner' } as any);
      Alert.alert('Success', 'Account created successfully!', [
        {
          text: 'OK',
          onPress: () =>
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'Home' }],
              })
            ),
        },
      ]);
    } catch (error: any) {
      Alert.alert('Registration Failed', error.message || 'Please try again');
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
              <Text style={styles.heroBadgeText}>Registration</Text>
            </View>
            <Text style={styles.wordmark}>FIND ASSURE</Text>
            <Text style={styles.heroTitle}>Create an owner account.</Text>
            <Text style={styles.heroBody}>Get access to search, verification history, and future claim tracking.</Text>
          </GlassCard>

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
  buttonGap: {
    marginTop: spacing.lg,
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
  linkText: {
    ...type.bodyStrong,
    color: palette.primaryDeep,
  },
});

export default RegisterScreen;
