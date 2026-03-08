import Constants from 'expo-constants';
import React, { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useAppTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { RootStackParamList } from '../types/models';
import { GlassCard } from '../components/GlassCard';

type SettingsNavigationProp = StackNavigationProp<RootStackParamList, 'Settings'>;

const THEME_OPTIONS = [
  { value: 'system', label: 'Use System', icon: 'phone-portrait-outline' },
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
] as const;

const SettingsScreen = () => {
  const navigation = useNavigation<SettingsNavigationProp>();
  const { user, signOut } = useAuth();
  const { theme, preference, setThemePreference } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const handleThemeChange = async (next: (typeof THEME_OPTIONS)[number]['value']) => {
    await setThemePreference(next);
    showToast({
      title: 'Appearance updated',
      message: `Theme set to ${next === 'system' ? 'system default' : next}.`,
      variant: 'success',
    });
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Do you want to log out of this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'Home' }],
              })
            );
          } catch (error: any) {
            showToast({
              title: 'Logout failed',
              message: error.message || 'Please try again.',
              variant: 'error',
            });
          }
        },
      },
    ]);
  };

  const version = Constants.expoConfig?.version || Constants.nativeAppVersion || '1.0.0';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GlassCard style={styles.section}>
          <Text style={styles.sectionEyebrow}>Appearance</Text>
          <Text style={styles.sectionTitle}>Theme</Text>
          <Text style={styles.sectionBody}>Choose whether FindAssure follows the system theme or stays fixed.</Text>
          <View style={styles.rowGroup}>
            {THEME_OPTIONS.map((option) => {
              const selected = preference === option.value;
              return (
                <Pressable key={option.value} style={[styles.row, selected && styles.rowSelected]} onPress={() => handleThemeChange(option.value)}>
                  <View style={styles.rowLeading}>
                    <View style={[styles.iconChip, selected && styles.iconChipSelected]}>
                      <Ionicons
                        name={option.icon}
                        size={18}
                        color={selected ? theme.colors.accent : theme.colors.textMuted}
                      />
                    </View>
                    <Text style={styles.rowTitle}>{option.label}</Text>
                  </View>
                  {selected ? <Ionicons name="checkmark-circle" size={20} color={theme.colors.accent} /> : null}
                </Pressable>
              );
            })}
          </View>
        </GlassCard>

        <GlassCard style={styles.section}>
          <Text style={styles.sectionEyebrow}>Help</Text>
          <Text style={styles.sectionTitle}>Support</Text>
          <Pressable style={styles.row} onPress={() => navigation.navigate('FAQ')}>
            <View style={styles.rowLeading}>
              <View style={styles.iconChip}>
                <Ionicons name="help-buoy-outline" size={18} color={theme.colors.textMuted} />
              </View>
              <View>
                <Text style={styles.rowTitle}>FAQ</Text>
                <Text style={styles.rowSubtitle}>Common answers about reporting, search, and verification.</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
          </Pressable>
        </GlassCard>

        <GlassCard style={styles.section}>
          <Text style={styles.sectionEyebrow}>Account</Text>
          <Text style={styles.sectionTitle}>Access</Text>
          {user ? (
            <>
              <Pressable style={styles.row} onPress={() => navigation.navigate('Profile')}>
                <View style={styles.rowLeading}>
                  <View style={styles.iconChip}>
                    <Ionicons name="person-outline" size={18} color={theme.colors.textMuted} />
                  </View>
                  <View>
                    <Text style={styles.rowTitle}>Profile</Text>
                    <Text style={styles.rowSubtitle}>Update your details and view claim history.</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
              </Pressable>

              {user.role === 'admin' ? (
                <Pressable style={styles.row} onPress={() => navigation.navigate('AdminDashboard')}>
                  <View style={styles.rowLeading}>
                    <View style={styles.iconChip}>
                      <Ionicons name="shield-checkmark-outline" size={18} color={theme.colors.textMuted} />
                    </View>
                    <View>
                      <Text style={styles.rowTitle}>Admin Dashboard</Text>
                      <Text style={styles.rowSubtitle}>Open moderation, user, and item review tools.</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
                </Pressable>
              ) : null}

              <Pressable style={styles.row} onPress={handleLogout}>
                <View style={styles.rowLeading}>
                  <View style={[styles.iconChip, styles.dangerChip]}>
                    <Ionicons name="log-out-outline" size={18} color={theme.colors.danger} />
                  </View>
                  <View>
                    <Text style={styles.rowTitle}>Logout</Text>
                    <Text style={styles.rowSubtitle}>Remove this device session and return to public mode.</Text>
                  </View>
                </View>
              </Pressable>
            </>
          ) : (
            <Pressable style={styles.row} onPress={() => navigation.navigate('Login')}>
              <View style={styles.rowLeading}>
                <View style={styles.iconChip}>
                  <Ionicons name="log-in-outline" size={18} color={theme.colors.textMuted} />
                </View>
                <View>
                  <Text style={styles.rowTitle}>Login / Register</Text>
                  <Text style={styles.rowSubtitle}>Sign in to search, verify claims, and manage your profile.</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
            </Pressable>
          )}
        </GlassCard>

        <GlassCard>
          <Text style={styles.sectionEyebrow}>About</Text>
          <Text style={styles.sectionTitle}>FindAssure</Text>
          <Text style={styles.sectionBody}>Lost-and-found matching with layered reporting and controlled owner verification.</Text>
          <Text style={styles.versionText}>{`Version ${version}`}</Text>
        </GlassCard>
      </ScrollView>
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
      gap: theme.spacing.md,
    },
    section: {
      marginBottom: theme.spacing.md,
    },
    sectionEyebrow: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    sectionTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.xs,
    },
    sectionBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.md,
    },
    rowGroup: {
      gap: theme.spacing.sm,
    },
    row: {
      minHeight: 58,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.cardMuted,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: theme.spacing.sm,
    },
    rowSelected: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSoft,
    },
    rowLeading: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      minWidth: 0,
      marginRight: theme.spacing.sm,
    },
    iconChip: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.backgroundElevated,
      marginRight: theme.spacing.md,
    },
    iconChipSelected: {
      backgroundColor: theme.colors.card,
    },
    dangerChip: {
      backgroundColor: theme.colors.dangerSoft,
    },
    rowTitle: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
    },
    rowSubtitle: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      marginTop: 2,
      maxWidth: '92%',
    },
    versionText: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
    },
  });

export default SettingsScreen;
