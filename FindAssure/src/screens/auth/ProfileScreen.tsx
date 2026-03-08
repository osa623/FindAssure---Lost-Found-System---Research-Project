import { CommonActions, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';
import { authApi } from '../../api/authApi';
import { FormInput } from '../../components/FormInput';
import { GlassCard } from '../../components/GlassCard';
import { InlineLoadingState } from '../../components/InlineLoadingState';
import { KeyboardAwareFormScreen } from '../../components/KeyboardAwareFormScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useAppTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { RootStackParamList } from '../../types/models';

type ProfileScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Profile'>;

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
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>Please login to view profile</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <KeyboardAwareFormScreen contentContainerStyle={styles.content}>
        <GlassCard style={styles.hero}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Profile</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.name ? user.name.charAt(0).toUpperCase() : 'U'}</Text>
          </View>
          <Text style={styles.heroTitle}>{user.name}</Text>
          <Text style={styles.heroBody}>Owner account · Member since {new Date(user.createdAt).toLocaleDateString()}</Text>
        </GlassCard>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Profile</Text>
          <Text style={styles.formTitle}>Personal information</Text>
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
          <PrimaryButton title="Save Changes" onPress={handleSave} loading={loading} size="lg" style={styles.buttonGap} />
        </GlassCard>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Security</Text>
          <Text style={styles.formTitle}>Session control</Text>
          <Text style={styles.sectionBody}>Signing out clears this device session and returns you to the public home screen.</Text>
          <PrimaryButton title="Logout" onPress={handleLogout} variant="danger" size="lg" style={styles.buttonGap} />
        </GlassCard>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Account info</Text>
          <Text style={styles.formTitle}>Stored details</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>User ID</Text>
            <Text style={styles.infoValue}>{user._id}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Role</Text>
            <Text style={styles.infoValue}>Item Owner</Text>
          </View>
        </GlassCard>

        <GlassCard>
          <Text style={styles.sectionEyebrow}>Claim history</Text>
          <Text style={styles.formTitle}>My claimed items</Text>
          {loadingClaimed ? (
            <InlineLoadingState label="Loading claimed items…" />
          ) : claimedItems.length === 0 ? (
            <Text style={styles.sectionBody}>No claimed items yet.</Text>
          ) : (
            claimedItems.map((item, index) => (
              <View key={index} style={styles.claimCard}>
                <Image
                  source={{ uri: item.foundItemId?.imageUrl || 'https://via.placeholder.com/100' }}
                  style={styles.itemImage}
                />
                <View style={styles.claimCopy}>
                  <Text style={styles.claimTitle}>{item.foundItemId?.category}</Text>
                  <Text style={styles.claimBody} numberOfLines={2}>
                    {item.foundItemId?.description}
                  </Text>
                  <Text style={styles.claimMeta}>Claimed {new Date(item.createdAt).toLocaleDateString()}</Text>
                  <Text style={styles.claimContact}>
                    Founder: {item.foundItemId?.founderContact?.name || 'N/A'} · {item.foundItemId?.founderContact?.email || 'N/A'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </GlassCard>
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
    emptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.xl,
      backgroundColor: theme.colors.background,
    },
    emptyText: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    hero: {
      padding: theme.spacing.lg,
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    heroBadge: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.accentSoft,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      marginBottom: theme.spacing.md,
    },
    heroBadgeText: {
      ...theme.type.caption,
      color: theme.colors.accent,
      fontWeight: '700',
    },
    avatar: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: theme.colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing.md,
    },
    avatarText: {
      ...theme.type.hero,
      color: theme.colors.accent,
      fontSize: 24,
      lineHeight: 28,
    },
    heroTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      textAlign: 'center',
      marginBottom: theme.spacing.xs,
    },
    heroBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      textAlign: 'center',
    },
    cardGap: {
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
    buttonGap: {
      marginTop: theme.spacing.lg,
    },
    sectionBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    infoRow: {
      marginBottom: theme.spacing.md,
    },
    infoLabel: {
      ...theme.type.label,
      marginBottom: 4,
    },
    infoValue: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      fontSize: 12,
      lineHeight: 16,
      flexShrink: 1,
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
      width: 78,
      height: 78,
      borderRadius: 18,
      backgroundColor: theme.colors.inputMuted,
    },
    claimCopy: {
      flex: 1,
    },
    claimTitle: {
      ...theme.type.cardTitle,
      color: theme.colors.textStrong,
      textTransform: 'capitalize',
      marginBottom: 4,
    },
    claimBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginBottom: 4,
    },
    claimMeta: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
      marginBottom: 4,
    },
    claimContact: {
      ...theme.type.caption,
      color: theme.colors.accent,
      lineHeight: 14,
    },
  });

export default ProfileScreen;
