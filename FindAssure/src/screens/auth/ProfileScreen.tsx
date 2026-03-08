import React, { useEffect, useState } from 'react';
import {
  Alert,
  Image,
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
import { authApi } from '../../api/authApi';
import { FormInput } from '../../components/FormInput';
import { GlassCard } from '../../components/GlassCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { gradients, palette, radius, spacing, type } from '../../theme/designSystem';

type ProfileScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Profile'>;

const ProfileScreen = () => {
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  const { user, updateProfile, signOut } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [claimedItems, setClaimedItems] = useState<any[]>([]);
  const [loadingClaimed, setLoadingClaimed] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
      fetchClaimedItems();
    }
  }, [user]);

  const fetchClaimedItems = async () => {
    try {
      setLoadingClaimed(true);
      const items = await authApi.getClaimedItems();
      setClaimedItems(items);
    } catch (error) {
      console.error('Failed to fetch claimed items:', error);
    } finally {
      setLoadingClaimed(false);
    }
  };

  const handleSave = async () => {
    if (!name || !email || !phone) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    try {
      setLoading(true);
      await updateProfile({ name, phone });
      Alert.alert('Success', 'Profile updated successfully');
    } catch (error: any) {
      Alert.alert('Update Failed', error.message || 'Please try again');
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
            Alert.alert('Error', error.message || 'Failed to logout');
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
    <LinearGradient colors={gradients.appBackground} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
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
            <Text style={styles.sectionBody}>Loading claimed items...</Text>
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
      </ScrollView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    ...type.body,
  },
  hero: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: palette.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    marginBottom: spacing.md,
  },
  heroBadgeText: {
    ...type.caption,
    color: palette.primaryDeep,
    fontWeight: '700',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: {
    ...type.hero,
    color: palette.primaryDeep,
    fontSize: 24,
    lineHeight: 28,
  },
  heroTitle: {
    ...type.section,
    color: palette.ink,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  heroBody: {
    ...type.body,
    color: palette.inkSoft,
    textAlign: 'center',
  },
  cardGap: {
    marginBottom: spacing.lg,
  },
  sectionEyebrow: {
    ...type.label,
    marginBottom: spacing.xs,
  },
  formTitle: {
    ...type.section,
    marginBottom: spacing.lg,
  },
  fieldGap: {
    marginBottom: spacing.md,
  },
  buttonGap: {
    marginTop: spacing.xl,
  },
  sectionBody: {
    ...type.body,
  },
  infoRow: {
    marginBottom: spacing.md,
  },
  infoLabel: {
    ...type.label,
    marginBottom: 4,
  },
  infoValue: {
    ...type.bodyStrong,
    fontSize: 12,
    lineHeight: 16,
    flexShrink: 1,
  },
  claimCard: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: palette.line,
    marginTop: spacing.md,
  },
  itemImage: {
    width: 78,
    height: 78,
    borderRadius: 18,
    backgroundColor: palette.shell,
  },
  claimCopy: {
    flex: 1,
  },
  claimTitle: {
    ...type.cardTitle,
    textTransform: 'capitalize',
    marginBottom: 4,
  },
  claimBody: {
    ...type.body,
    marginBottom: 4,
  },
  claimMeta: {
    ...type.caption,
    marginBottom: 4,
  },
  claimContact: {
    ...type.caption,
    color: palette.primaryDeep,
    lineHeight: 14,
  },
});

export default ProfileScreen;
