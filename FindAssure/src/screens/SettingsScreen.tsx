import { Ionicons } from '@expo/vector-icons';
import { setStringAsync } from 'expo-clipboard';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { GlassCard } from '../components/GlassCard';
import { StaggeredEntrance } from '../components/StaggeredEntrance';
import { useAuth } from '../context/AuthContext';
import { useAppTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { RootStackParamList } from '../types/models';

type SettingsNavigationProp = StackNavigationProp<RootStackParamList, 'Settings'>;

const THEME_OPTIONS = [
  {
    value: 'system',
    label: 'Use System',
    shortLabel: 'System',
    icon: 'phone-portrait-outline',
    hint: 'Match your device appearance automatically.',
  },
  {
    value: 'light',
    label: 'Light',
    shortLabel: 'Light',
    icon: 'sunny-outline',
    hint: 'Keep the app bright and easier to scan outdoors.',
  },
  {
    value: 'dark',
    label: 'Dark',
    shortLabel: 'Dark',
    icon: 'moon-outline',
    hint: 'Reduce glare in lower-light environments.',
  },
] as const;

const SettingsScreen = () => {
  const navigation = useNavigation<SettingsNavigationProp>();
  const { user, signOut } = useAuth();
  const { theme, preference, resolvedMode, setThemePreference } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const version = Constants.expoConfig?.version || Constants.nativeAppVersion || '1.0.0';
  const currentTheme = useMemo(
    () => THEME_OPTIONS.find((option) => option.value === preference) ?? THEME_OPTIONS[0],
    [preference]
  );

  const overviewChips = useMemo(
    () => [
      {
        key: 'mode',
        icon: resolvedMode === 'dark' ? 'moon' : 'sunny',
        text: `${currentTheme.shortLabel} mode`,
      },
      {
        key: 'account',
        icon: user?.role === 'admin' ? 'shield-checkmark' : user ? 'person-circle' : 'sparkles',
        text: user ? (user.role === 'admin' ? 'Admin access' : 'Owner account') : 'Guest access',
      },
      {
        key: 'version',
        icon: 'cube-outline',
        text: `Version ${version}`,
      },
    ],
    [currentTheme.shortLabel, resolvedMode, user, version]
  );

  const handleThemeChange = async (next: (typeof THEME_OPTIONS)[number]['value']) => {
    await setThemePreference(next);
    showToast({
      title: 'Appearance updated',
      message: `Theme set to ${next === 'system' ? 'system default' : next}.`,
      variant: 'success',
    });
  };

  const handleCopyVersion = async () => {
    await setStringAsync(version);
    showToast({
      title: 'Version copied',
      message: `App version ${version} copied to clipboard.`,
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

  return (
    <LinearGradient colors={theme.gradients.appBackground} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <StaggeredEntrance>
          <GlassCard style={styles.heroShell} contentStyle={styles.heroShellInner}>
            <LinearGradient colors={theme.gradients.heroAlt} style={styles.heroCard}>
              <View style={styles.heroGlowPrimary} />
              <View style={styles.heroGlowSecondary} />

              <View style={styles.heroTop}>
                <View style={styles.heroBadge}>
                  <Text style={styles.heroBadgeText}>Preferences</Text>
                </View>
                <Text style={styles.heroWordmark}>FindAssure</Text>
              </View>

              <Text style={styles.heroTitle}>Tune the app once. Keep recovery tools close.</Text>
              <Text style={styles.heroBody}>Manage appearance, account access, and local help in one place.</Text>

              <View style={styles.heroChipRow}>
                {overviewChips.map((chip) => (
                  <View key={chip.key} style={styles.heroChip}>
                    <Ionicons name={chip.icon as keyof typeof Ionicons.glyphMap} size={14} color={theme.colors.onTint} />
                    <Text style={styles.heroChipText}>{chip.text}</Text>
                  </View>
                ))}
              </View>
            </LinearGradient>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={70}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionEyebrow}>Appearance</Text>
            <Text style={styles.sectionTitle}>Choose how FindAssure looks.</Text>
            <Text style={styles.sectionBody}>Currently using {currentTheme.shortLabel.toLowerCase()} with {resolvedMode} visuals.</Text>

            <View style={styles.themeOptions}>
              {THEME_OPTIONS.map((option) => {
                const selected = preference === option.value;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.themeOption, selected && styles.themeOptionSelected]}
                    onPress={() => handleThemeChange(option.value)}
                  >
                    <View style={[styles.themeIconWrap, selected && styles.themeIconWrapSelected]}>
                      <Ionicons
                        name={option.icon}
                        size={18}
                        color={selected ? theme.colors.accent : theme.colors.textStrong}
                      />
                    </View>
                    <View style={styles.themeCopy}>
                      <Text style={styles.themeTitle}>{option.label}</Text>
                      <Text style={styles.themeHint}>{option.hint}</Text>
                    </View>
                    {selected ? <Ionicons name="checkmark-circle" size={20} color={theme.colors.accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={120}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionEyebrow}>Account & access</Text>
            <Text style={styles.sectionTitle}>{user ? 'Account access' : 'Sign in when you need owner tools.'}</Text>
            <Text style={styles.sectionBody}>
              {user
                ? 'Open profile details, reach admin tools if available, or clear this device session.'
                : 'Guest mode keeps reporting open. Sign in for search, verification, and profile tools.'}
            </Text>

            <View style={styles.actionGroup}>
              {user ? (
                <>
                  <SettingsRow
                    icon="person-outline"
                    title="Profile"
                    subtitle="Update your details and review claimed items."
                    onPress={() => navigation.navigate('Profile')}
                  />
                  {user.role === 'admin' ? (
                    <SettingsRow
                      icon="shield-checkmark-outline"
                      title="Admin Dashboard"
                      subtitle="Open moderation, verification, and review tools."
                      onPress={() => navigation.navigate('AdminDashboard')}
                    />
                  ) : null}
                </>
              ) : (
                <SettingsRow
                  icon="log-in-outline"
                  title="Login / Register"
                  subtitle="Unlock owner search and claim verification."
                  onPress={() => navigation.navigate('Login')}
                />
              )}
            </View>

            {user ? (
              <View style={styles.dangerZone}>
                <Text style={styles.dangerLabel}>Session</Text>
                <Pressable style={styles.dangerRow} onPress={handleLogout}>
                  <View style={styles.rowLeading}>
                    <View style={[styles.iconChip, styles.dangerIconChip]}>
                      <Ionicons name="log-out-outline" size={18} color={theme.colors.danger} />
                    </View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>Logout</Text>
                      <Text style={styles.rowSubtitle}>Remove this device session and return to public mode.</Text>
                    </View>
                  </View>
                  <Ionicons name="arrow-forward" size={18} color={theme.colors.danger} />
                </Pressable>
              </View>
            ) : null}
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={170}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionEyebrow}>Help & about</Text>
            <Text style={styles.sectionTitle}>Help and app details</Text>
            <Text style={styles.sectionBody}>Use local guidance and quick app info without leaving the flow.</Text>

            <View style={styles.actionGroup}>
              <SettingsRow
                icon="search-outline"
                title="Open FAQ"
                subtitle="Search common answers about reporting, search, and verification."
                onPress={() => navigation.navigate('FAQ')}
              />
              <Pressable style={styles.aboutCard} onPress={handleCopyVersion}>
                <View style={styles.aboutHeader}>
                  <View style={styles.iconChip}>
                    <Ionicons name="information-circle-outline" size={18} color={theme.colors.textStrong} />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle}>About this app</Text>
                    <Text style={styles.rowSubtitle}>Version and current theme, with quick copy support.</Text>
                  </View>
                </View>

                <View style={styles.aboutMeta}>
                  <View style={styles.aboutMetaChip}>
                    <Text style={styles.aboutMetaLabel}>Version</Text>
                    <Text style={styles.aboutMetaValue}>{version}</Text>
                  </View>
                  <View style={styles.aboutMetaChip}>
                    <Text style={styles.aboutMetaLabel}>Theme</Text>
                    <Text style={styles.aboutMetaValue}>{resolvedMode}</Text>
                  </View>
                </View>

                <Text style={styles.copyHint}>Tap to copy the current app version.</Text>
              </Pressable>
            </View>
          </GlassCard>
        </StaggeredEntrance>
      </ScrollView>
    </LinearGradient>
  );
};

const SettingsRow = ({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowLeading}>
        <View style={styles.iconChip}>
          <Ionicons name={icon} size={18} color={theme.colors.textStrong} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
    </Pressable>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xxxl,
      gap: theme.spacing.md,
    },
    heroShell: {
      overflow: 'hidden',
      ...theme.shadows.floating,
    },
    heroShellInner: {
      padding: 0,
      overflow: 'hidden',
    },
    heroCard: {
      padding: theme.spacing.lg,
      position: 'relative',
      overflow: 'hidden',
    },
    heroGlowPrimary: {
      position: 'absolute',
      width: 180,
      height: 180,
      borderRadius: 90,
      top: -36,
      right: -42,
      backgroundColor: theme.colors.inverse,
      opacity: theme.isDark ? 0.06 : 0.12,
    },
    heroGlowSecondary: {
      position: 'absolute',
      width: 140,
      height: 140,
      borderRadius: 70,
      bottom: -48,
      left: -24,
      backgroundColor: theme.colors.inverse,
      opacity: theme.isDark ? 0.05 : 0.08,
    },
    heroTop: {
      marginBottom: theme.spacing.md,
    },
    heroBadge: {
      alignSelf: 'flex-start',
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      marginBottom: theme.spacing.sm,
      backgroundColor: theme.colors.tintSurface,
      borderWidth: 1,
      borderColor: theme.colors.tintBorder,
    },
    heroBadgeText: {
      ...theme.type.caption,
      color: theme.colors.onTint,
      fontWeight: '700',
    },
    heroWordmark: {
      ...theme.type.brand,
      color: theme.colors.onTint,
    },
    heroTitle: {
      ...theme.type.title,
      color: theme.colors.onTint,
      marginBottom: theme.spacing.sm,
      maxWidth: '92%',
    },
    heroBody: {
      ...theme.type.body,
      color: theme.colors.onTintMuted,
      maxWidth: '92%',
    },
    heroChipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.lg,
    },
    heroChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 7,
      backgroundColor: theme.colors.tintSurface,
      borderWidth: 1,
      borderColor: theme.colors.tintBorder,
    },
    heroChipText: {
      ...theme.type.caption,
      color: theme.colors.onTint,
      fontWeight: '700',
    },
    sectionCard: {
      ...theme.shadows.soft,
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
    themeOptions: {
      gap: theme.spacing.sm,
    },
    themeOption: {
      minHeight: 72,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.cardMuted,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    themeOptionSelected: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSoft,
    },
    themeIconWrap: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.backgroundElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    themeIconWrapSelected: {
      backgroundColor: theme.colors.card,
      borderColor: theme.colors.borderStrong,
    },
    themeCopy: {
      flex: 1,
      minWidth: 0,
    },
    themeTitle: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      marginBottom: 2,
    },
    themeHint: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
    },
    actionGroup: {
      gap: theme.spacing.sm,
    },
    row: {
      minHeight: 68,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.cardMuted,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    rowLeading: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      flex: 1,
      minWidth: 0,
      marginRight: theme.spacing.sm,
    },
    rowCopy: {
      flex: 1,
      minWidth: 0,
    },
    iconChip: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.backgroundElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginRight: theme.spacing.md,
    },
    rowTitle: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
    },
    rowSubtitle: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      marginTop: 2,
    },
    dangerZone: {
      marginTop: theme.spacing.md,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      paddingTop: theme.spacing.md,
    },
    dangerLabel: {
      ...theme.type.label,
      color: theme.colors.danger,
      marginBottom: theme.spacing.sm,
    },
    dangerRow: {
      minHeight: 68,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.dangerSoft,
      backgroundColor: theme.colors.dangerSoft,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    dangerIconChip: {
      backgroundColor: theme.colors.card,
      borderColor: theme.colors.dangerSoft,
    },
    aboutCard: {
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.cardMuted,
      padding: theme.spacing.md,
    },
    aboutHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: theme.spacing.md,
    },
    aboutMeta: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
    },
    aboutMetaChip: {
      flex: 1,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 7,
      backgroundColor: theme.colors.card,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    aboutMetaLabel: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
      marginBottom: 2,
    },
    aboutMetaValue: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
    },
    copyHint: {
      ...theme.type.caption,
      color: theme.colors.accent,
      fontWeight: '700',
    },
  });

export default SettingsScreen;
