import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../../types/models';
import { GlassCard } from '../../components/GlassCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StaggeredEntrance } from '../../components/StaggeredEntrance';
import { itemsApi } from '../../api/itemsApi';
import { useAppTheme } from '../../context/ThemeContext';
import { getDisplayImageUri } from '../../utils/cloudinaryImage';
import { getVisualMatchDisplay } from '../../utils/visualMatch';
import { getAdminItemStatusTone, getAdminPalette } from './adminTheme';

type AdminItemDetailRouteProp = RouteProp<RootStackParamList, 'AdminItemDetail'>;

const AdminItemDetailScreen = () => {
  const route = useRoute<AdminItemDetailRouteProp>();
  const { foundItem } = route.params;
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const adminPalette = useMemo(() => getAdminPalette(theme), [theme]);

  const [currentStatus, setCurrentStatus] = useState(foundItem.status);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const visualMatch = getVisualMatchDisplay(foundItem.imageMatch?.score);

  const formatLocation = (locations: typeof foundItem.found_location) => {
    if (!locations || locations.length === 0) return 'Location not specified';

    return locations
      .map((loc) => {
        let locationStr = loc.location;
        if (loc.floor_id) locationStr += ` - Floor: ${loc.floor_id}`;
        if (loc.hall_name) locationStr += ` - Hall: ${loc.hall_name}`;
        return locationStr;
      })
      .join('\n');
  };

  const handleChangeStatus = async (newStatus: string) => {
    Alert.alert('Confirm Status Change', `Change status to "${newStatus}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          try {
            setPendingStatus(newStatus);
            await itemsApi.updateFoundItemStatus(foundItem._id, newStatus);
            setCurrentStatus(newStatus as any);
            Alert.alert('Success', 'Status updated successfully');
          } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to update status');
          } finally {
            setPendingStatus(null);
          }
        },
      },
    ]);
  };

  const statusTone = getAdminItemStatusTone(theme, currentStatus);

  return (
    <LinearGradient colors={theme.gradients.appBackground} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <StaggeredEntrance delay={20}>
          <GlassCard style={styles.mediaCard} contentStyle={styles.mediaCardContent}>
            <Image source={{ uri: getDisplayImageUri(foundItem.imageUrl) }} style={styles.image} contentFit="cover" cachePolicy="memory-disk" transition={120} />
            <View style={styles.heroBody}>
              <View style={styles.badgeRow}>
                <View style={[styles.adminBadge, { backgroundColor: adminPalette.accentSoft }]}>
                  <Text style={[styles.adminBadgeText, { color: adminPalette.accentText }]}>Admin-only view</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: statusTone.backgroundColor }]}>
                  <Text style={[styles.statusText, { color: statusTone.textColor }]}>
                    {currentStatus.split('_').join(' ')}
                  </Text>
                </View>
                {visualMatch ? (
                  <View style={styles.visualMatchBadge}>
                    <Text style={styles.visualMatchText}>{visualMatch.label}</Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.eyebrow}>Found item oversight</Text>
              <Text style={styles.category}>{foundItem.category}</Text>
              <Text style={styles.description}>{foundItem.description}</Text>
            </View>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={80}>
          <View style={styles.metaGrid}>
            <GlassCard style={styles.metaCard}>
              <Text style={styles.metaLabel}>Found location</Text>
              <Text style={styles.metaValue}>{formatLocation(foundItem.found_location)}</Text>
            </GlassCard>
            <GlassCard style={styles.metaCard}>
              <Text style={styles.metaLabel}>Date found</Text>
              <Text style={styles.metaValue}>
                {new Date(foundItem.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </GlassCard>
          </View>
        </StaggeredEntrance>

        <StaggeredEntrance delay={120}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionEyebrow}>Founder contact</Text>
            <Text style={styles.sectionTitle}>Visible only to administrators</Text>
            {[
              { label: 'Name', value: foundItem.founderContact?.name || 'N/A', icon: 'person-outline' as const },
              { label: 'Email', value: foundItem.founderContact?.email || 'N/A', icon: 'mail-outline' as const },
              { label: 'Phone', value: foundItem.founderContact?.phone || 'N/A', icon: 'call-outline' as const },
            ].map((field) => (
              <View key={field.label} style={styles.detailRow}>
                <Ionicons name={field.icon} size={17} color={theme.colors.textMuted} />
                <View style={styles.detailCopy}>
                  <Text style={styles.detailLabel}>{field.label}</Text>
                  <Text style={styles.detailValue}>{field.value}</Text>
                </View>
              </View>
            ))}
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={160}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionEyebrow}>Verification prompts</Text>
            <Text style={styles.sectionTitle}>Founder questions and protected answers</Text>
            <View style={styles.warningNote}>
              <Ionicons name="warning-outline" size={18} color={adminPalette.accent} />
              <Text style={styles.warningText}>
                Do not disclose founder answers until the claimant has been verified.
              </Text>
            </View>
            {foundItem.questions.map((question, index) => (
              <GlassCard key={`${question}-${index}`} style={styles.qaCard} intensity={24}>
                <Text style={styles.questionLabel}>Question {index + 1}</Text>
                <Text style={styles.questionText}>{question}</Text>
                <View style={styles.answerBlock}>
                  <Text style={styles.answerLabel}>Founder answer</Text>
                  <Text style={styles.answerText}>{foundItem.founderAnswers?.[index] || 'N/A'}</Text>
                </View>
              </GlassCard>
            ))}
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={200}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionEyebrow}>Status control</Text>
            <Text style={styles.sectionTitle}>Update item state</Text>
            <Text style={styles.sectionBody}>
              Keep the verification queue accurate by marking the item as available, pending review, or claimed.
            </Text>
            <View style={styles.statusButtons}>
              <PrimaryButton
                title="Mark Available"
                onPress={() => handleChangeStatus('available')}
                disabled={Boolean(pendingStatus) || currentStatus === 'available'}
                loading={pendingStatus === 'available'}
                size="lg"
              />
              <PrimaryButton
                title="Mark Pending"
                onPress={() => handleChangeStatus('pending_verification')}
                disabled={Boolean(pendingStatus) || currentStatus === 'pending_verification'}
                loading={pendingStatus === 'pending_verification'}
                size="lg"
                variant="secondary"
              />
              <PrimaryButton
                title="Mark Claimed"
                onPress={() => handleChangeStatus('claimed')}
                disabled={Boolean(pendingStatus) || currentStatus === 'claimed'}
                loading={pendingStatus === 'claimed'}
                size="lg"
                variant="ghost"
                style={StyleSheet.flatten([styles.claimedButton, { borderColor: theme.colors.borderStrong }])}
              />
            </View>
          </GlassCard>
        </StaggeredEntrance>

        <GlassCard style={styles.metadataCard} intensity={24}>
          <Text style={styles.metadataLabel}>Item ID: {foundItem._id}</Text>
          {foundItem.updatedAt ? (
            <Text style={styles.metadataLabel}>
              Last updated: {new Date(foundItem.updatedAt).toLocaleString()}
            </Text>
          ) : null}
        </GlassCard>
      </ScrollView>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    content: {
      paddingTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
      gap: theme.spacing.md,
    },
    mediaCard: {
      marginBottom: 0,
    },
    mediaCardContent: {
      padding: 0,
    },
    image: {
      width: '100%',
      height: 280,
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
      backgroundColor: theme.colors.inputMuted,
    },
    heroBody: {
      padding: theme.spacing.md,
    },
    badgeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
    },
    adminBadge: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
    },
    adminBadgeText: {
      ...theme.type.caption,
      fontWeight: '700',
    },
    statusBadge: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
    },
    statusText: {
      ...theme.type.caption,
      fontWeight: '700',
      textTransform: 'capitalize',
    },
    visualMatchBadge: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      backgroundColor: theme.colors.accentSoft,
    },
    visualMatchText: {
      ...theme.type.caption,
      color: theme.colors.accent,
      fontWeight: '700',
    },
    eyebrow: {
      ...theme.type.label,
      color: theme.colors.textSubtle,
      marginBottom: theme.spacing.xs,
    },
    category: {
      ...theme.type.hero,
      color: theme.colors.textStrong,
      textTransform: 'capitalize',
      marginBottom: theme.spacing.sm,
    },
    description: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    metaGrid: {
      gap: theme.spacing.md,
    },
    metaCard: {
      minHeight: 108,
    },
    metaLabel: {
      ...theme.type.label,
      marginBottom: theme.spacing.sm,
    },
    metaValue: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      lineHeight: 22,
    },
    sectionCard: {
      marginBottom: 0,
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
      marginBottom: theme.spacing.lg,
    },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    detailCopy: {
      flex: 1,
    },
    detailLabel: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
      marginBottom: 2,
    },
    detailValue: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
    },
    warningNote: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      alignItems: 'flex-start',
      backgroundColor: theme.colors.dangerSoft,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    warningText: {
      ...theme.type.body,
      color: theme.colors.textStrong,
      flex: 1,
    },
    qaCard: {
      marginBottom: theme.spacing.sm,
    },
    questionLabel: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
      marginBottom: 4,
      textTransform: 'uppercase',
    },
    questionText: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.md,
    },
    answerBlock: {
      backgroundColor: theme.colors.cardMuted,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.accent,
    },
    answerLabel: {
      ...theme.type.caption,
      color: theme.colors.accent,
      marginBottom: 4,
      fontWeight: '700',
    },
    answerText: {
      ...theme.type.body,
      color: theme.colors.textStrong,
    },
    statusButtons: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.lg,
    },
    claimedButton: {
      borderWidth: 1,
    },
    metadataCard: {
      marginBottom: 0,
    },
    metadataLabel: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
      marginBottom: 4,
    },
  });

export default AdminItemDetailScreen;
