import { Ionicons } from '@expo/vector-icons';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { authApi } from '../../api/authApi';
import { AnimatedHeroIllustration } from '../../components/AnimatedHeroIllustration';
import { FormInput } from '../../components/FormInput';
import { GlassCard } from '../../components/GlassCard';
import { InlineLoadingState } from '../../components/InlineLoadingState';
import { KeyboardAwareFormScreen } from '../../components/KeyboardAwareFormScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StaggeredEntrance } from '../../components/StaggeredEntrance';
import { useAuth } from '../../context/AuthContext';
import { useAppTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { RootStackParamList } from '../../types/models';
import { getDisplayImageUri } from '../../utils/cloudinaryImage';

type ProfileScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Profile'>;

const formatMemberSince = (date: string) =>
  new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });

const formatClaimDate = (date: string) =>
  new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

const ProfileScreen = () => {
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  const { user, updateProfile, signOut } = useAuth();
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [claimedItems, setClaimedItems] = useState<any[]>([]);
  const [loadingClaimed, setLoadingClaimed] = useState(false);

  const fetchClaimedItems = useCallback(async () => {
    try {
      setLoadingClaimed(true);
      const items = await authApi.getClaimedItems();
      setClaimedItems(items);
    } catch (error) {
      console.error('Failed to fetch claimed items:', error);
      showToast({
        title: 'Could not load claimed items',
        message: 'Please try again later.',
        variant: 'error',
      });
    } finally {
      setLoadingClaimed(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
      fetchClaimedItems();
    }
  }, [fetchClaimedItems, user]);

  const handleSave = async () => {
    if (!name || !email || !phone) {
      showToast({
        title: 'Missing details',
        message: 'Please fill in all fields.',
        variant: 'warning',
      });
      return;
    }

    try {
      setLoading(true);
      await updateProfile({ name, phone });
      showToast({
        title: 'Profile updated',
        message: 'Your details were saved successfully.',
        variant: 'success',
      });
    } catch (error: any) {
      showToast({
        title: 'Update failed',
        message: error.message || 'Please try again.',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
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

  if (!user) {
    return (
      <View style={styles.container}>
        <KeyboardAwareFormScreen contentContainerStyle={styles.content}>
          <StaggeredEntrance delay={20}>
            <GlassCard style={styles.emptyHero}>
              <View style={styles.emptyHeroTopRow}>
                <View style={styles.heroBadge}>
                  <Text style={styles.heroBadgeText}>Account profile</Text>
                </View>
                <AnimatedHeroIllustration size={108} variant="auth" />
              </View>
              <Text style={styles.emptyTitle}>Sign in to manage your account.</Text>
              <Text style={styles.emptyBody}>
                Update your contact details, review claimed items, and keep your account information ready for future
                verification.
              </Text>
              <PrimaryButton title="Login" onPress={() => navigation.navigate('Login')} size="lg" style={styles.emptyButton} />
            </GlassCard>
          </StaggeredEntrance>
        </KeyboardAwareFormScreen>
      </View>
    );
  }

  const memberSince = formatMemberSince(user.createdAt);

  return (
    <View style={styles.container}>
      <KeyboardAwareFormScreen contentContainerStyle={styles.content}>
        <StaggeredEntrance delay={20}>
          <GlassCard style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>Account profile</Text>
              </View>
              <View style={styles.statusChip}>
                <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} />
                <Text style={styles.statusChipText}>Active</Text>
              </View>
            </View>

            <View style={styles.heroIdentityRow}>
              <View style={styles.avatarWrap}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{user.name ? user.name.charAt(0).toUpperCase() : 'U'}</Text>
                </View>
                <View style={styles.presenceDot} />
              </View>

              <View style={styles.heroCopy}>
                <Text style={styles.heroTitle}>{user.name}</Text>
                <Text style={styles.heroBody}>Owner account</Text>
                <Text style={styles.heroSubtext}>Member since {memberSince}</Text>
              </View>
            </View>

            <View style={styles.heroChipRow}>
              <View style={styles.summaryChip}>
                <Text style={styles.summaryChipLabel}>Claimed</Text>
                <Text style={styles.summaryChipValue}>{claimedItems.length}</Text>
              </View>
              <View style={styles.summaryChip}>
                <Text style={styles.summaryChipLabel}>Role</Text>
                <Text style={styles.summaryChipValue}>{user.role === 'admin' ? 'Admin' : 'Owner'}</Text>
              </View>
              <View style={styles.summaryChip}>
                <Text style={styles.summaryChipLabel}>Joined</Text>
                <Text style={styles.summaryChipValue}>{memberSince}</Text>
              </View>
            </View>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={80}>
          <GlassCard style={styles.cardGap}>
            <Text style={styles.sectionEyebrow}>Overview</Text>
            <Text style={styles.sectionTitle}>Account snapshot</Text>

            <View style={styles.overviewGrid}>
              {[
                {
                  icon: 'bag-check-outline' as const,
                  label: 'Claimed items',
                  value: String(claimedItems.length),
                },
                {
                  icon: 'person-circle-outline' as const,
                  label: 'Account type',
                  value: 'Item Owner',
                },
                {
                  icon: 'call-outline' as const,
                  label: 'Phone status',
                  value: phone ? 'Available' : 'Missing',
                },
              ].map((item) => (
                <View key={item.label} style={styles.overviewTile}>
                  <View style={styles.overviewIconWrap}>
                    <Ionicons name={item.icon} size={18} color={theme.colors.accent} />
                  </View>
                  <Text style={styles.overviewLabel}>{item.label}</Text>
                  <Text style={styles.overviewValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={120}>
          <GlassCard style={styles.cardGap}>
            <Text style={styles.sectionEyebrow}>Profile details</Text>
            <Text style={styles.sectionTitle}>Personal information</Text>
            <Text style={styles.sectionBody}>
              Keep your contact details accurate so verified founders can reach you quickly after a successful claim.
            </Text>

            <FormInput
              label="Full name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              leadingIcon="person-outline"
              containerStyle={styles.fieldGap}
            />
            <FormInput
              label="Email"
              value={email}
              editable={false}
              hint="Email cannot be changed"
              leadingIcon="mail-outline"
              containerStyle={styles.fieldGap}
            />
            <FormInput
              label="Phone number"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              leadingIcon="call-outline"
            />

            <PrimaryButton title="Save Profile Details" onPress={handleSave} loading={loading} size="lg" style={styles.buttonGap} />
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={160}>
          <GlassCard style={styles.cardGap}>
            <Text style={styles.sectionEyebrow}>Tools & session</Text>
            <Text style={styles.sectionTitle}>Settings and sign out</Text>
            <Text style={styles.sectionBody}>
              Open settings or sign out when you want to clear this device session.
            </Text>

            <Pressable style={styles.toolRow} onPress={() => navigation.navigate('Settings')}>
              <View style={styles.toolLeading}>
                <View style={styles.toolIconWrap}>
                  <Ionicons name="settings-outline" size={18} color={theme.colors.textStrong} />
                </View>
                <View style={styles.toolCopy}>
                  <Text style={styles.toolTitle}>Settings</Text>
                  <Text style={styles.toolSubtitle}>Appearance, help center, version info, and app preferences.</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
            </Pressable>

            <PrimaryButton title="Logout" onPress={handleLogout} variant="danger" size="lg" style={styles.buttonGap} />
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={200}>
          <GlassCard>
            <View style={styles.claimSectionHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>Claim history</Text>
                <Text style={styles.sectionTitle}>My claimed items</Text>
              </View>
              <Text style={styles.claimCountText}>{claimedItems.length}</Text>
            </View>

            {loadingClaimed ? (
              <InlineLoadingState label="Loading claimed items…" style={styles.claimLoading} />
            ) : claimedItems.length === 0 ? (
              <View style={styles.emptyClaimState}>
                <Ionicons name="archive-outline" size={20} color={theme.colors.textSubtle} />
                <Text style={styles.emptyClaimTitle}>No claimed items yet</Text>
                <Text style={styles.emptyClaimBody}>
                  Once a claim is verified, the item and founder contact details will appear here.
                </Text>
              </View>
            ) : (
              claimedItems.map((item, index) => (
                <View key={item._id || item.id || `${item.createdAt}-${index}`} style={styles.claimCard}>
                  <Image
                    source={{ uri: getDisplayImageUri(item.foundItemId?.imageUrl) || 'https://via.placeholder.com/100' }}
                    style={styles.itemImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={120}
                  />

                  <View style={styles.claimCopy}>
                    <View style={styles.claimHeader}>
                      <Text style={styles.claimTitle} numberOfLines={1}>
                        {item.foundItemId?.category || 'Claimed item'}
                      </Text>
                      <View style={styles.claimBadge}>
                        <Text style={styles.claimBadgeText}>Claimed</Text>
                      </View>
                    </View>

                    <Text style={styles.claimBody} numberOfLines={2}>
                      {item.foundItemId?.description || 'No description available.'}
                    </Text>

                    <View style={styles.claimMetaRow}>
                      <Ionicons name="calendar-outline" size={14} color={theme.colors.textSubtle} />
                      <Text style={styles.claimMetaText}>Claimed {formatClaimDate(item.createdAt)}</Text>
                    </View>

                    <View style={styles.claimMetaRow}>
                      <Ionicons name="person-outline" size={14} color={theme.colors.textSubtle} />
                      <Text style={styles.claimMetaText} numberOfLines={1}>
                        Founder {item.foundItemId?.founderContact?.name || 'N/A'}
                      </Text>
                    </View>

                    <View style={styles.claimMetaRow}>
                      <Ionicons name="mail-outline" size={14} color={theme.colors.textSubtle} />
                      <Text style={styles.claimContactText} numberOfLines={1}>
                        {item.foundItemId?.founderContact?.email || 'N/A'}
                      </Text>
                    </View>
                  </View>
                </View>
              ))
            )}
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
    content: {
      paddingTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
    },
    heroBadge: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.accentSoft,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
    },
    heroBadgeText: {
      ...theme.type.caption,
      color: theme.colors.accent,
      fontWeight: '700',
    },
    emptyHero: {
      padding: theme.spacing.lg,
      marginBottom: theme.spacing.md,
    },
    emptyHeroTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: theme.spacing.md,
    },
    emptyTitle: {
      ...theme.type.title,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.sm,
    },
    emptyBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    emptyButton: {
      marginTop: theme.spacing.lg,
    },
    heroCard: {
      padding: theme.spacing.lg,
      marginBottom: theme.spacing.md,
    },
    heroTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    statusChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
      backgroundColor: theme.colors.successSoft,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
    },
    statusChipText: {
      ...theme.type.caption,
      color: theme.colors.success,
      fontWeight: '700',
    },
    heroIdentityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    },
    avatarWrap: {
      position: 'relative',
    },
    avatar: {
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: theme.colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
    },
    avatarText: {
      ...theme.type.hero,
      color: theme.colors.accent,
      fontSize: 28,
      lineHeight: 34,
    },
    presenceDot: {
      position: 'absolute',
      right: 3,
      bottom: 3,
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: theme.colors.success,
      borderWidth: 2,
      borderColor: theme.colors.card,
    },
    heroCopy: {
      flex: 1,
      minWidth: 0,
    },
    heroTitle: {
      ...theme.type.title,
      color: theme.colors.textStrong,
      marginBottom: 4,
    },
    heroBody: {
      ...theme.type.bodyStrong,
      color: theme.colors.textMuted,
      marginBottom: 2,
    },
    heroSubtext: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
    },
    heroChipRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.lg,
    },
    summaryChip: {
      flex: 1,
      minHeight: 74,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.cardMuted,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      justifyContent: 'space-between',
    },
    summaryChipLabel: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
    },
    summaryChipValue: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
    },
    cardGap: {
      marginBottom: theme.spacing.md,
    },
    sectionEyebrow: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    sectionTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.sm,
    },
    sectionBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.md,
    },
    overviewGrid: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    overviewTile: {
      flex: 1,
      minHeight: 108,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.cardMuted,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      justifyContent: 'space-between',
    },
    overviewIconWrap: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.accentSoft,
      marginBottom: theme.spacing.sm,
    },
    overviewLabel: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
      marginBottom: 4,
    },
    overviewValue: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
    },
    fieldGap: {
      marginBottom: theme.spacing.md,
    },
    buttonGap: {
      marginTop: theme.spacing.lg,
    },
    toolRow: {
      minHeight: 68,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.cardMuted,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    toolLeading: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      minWidth: 0,
      marginRight: theme.spacing.sm,
    },
    toolIconWrap: {
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
    toolCopy: {
      flex: 1,
    },
    toolTitle: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
    },
    toolSubtitle: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      marginTop: 2,
    },
    claimSectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    claimCountText: {
      ...theme.type.hero,
      color: theme.colors.accent,
      fontSize: 22,
      lineHeight: 26,
    },
    claimLoading: {
      paddingVertical: theme.spacing.xl,
    },
    emptyClaimState: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.cardMuted,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingVertical: theme.spacing.xl,
      paddingHorizontal: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    emptyClaimTitle: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      textAlign: 'center',
    },
    emptyClaimBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      textAlign: 'center',
    },
    claimCard: {
      flexDirection: 'row',
      gap: theme.spacing.md,
      padding: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.cardMuted,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginTop: theme.spacing.md,
    },
    itemImage: {
      width: 88,
      height: 88,
      borderRadius: 22,
      backgroundColor: theme.colors.inputMuted,
    },
    claimCopy: {
      flex: 1,
      minWidth: 0,
    },
    claimHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
      marginBottom: 4,
    },
    claimTitle: {
      ...theme.type.cardTitle,
      color: theme.colors.textStrong,
      textTransform: 'capitalize',
      flex: 1,
    },
    claimBadge: {
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.successSoft,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
    },
    claimBadgeText: {
      ...theme.type.caption,
      color: theme.colors.success,
      fontWeight: '700',
    },
    claimBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.sm,
    },
    claimMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
      marginBottom: 4,
    },
    claimMetaText: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
      flex: 1,
    },
    claimContactText: {
      ...theme.type.caption,
      color: theme.colors.accent,
      flex: 1,
    },
  });

export default ProfileScreen;
