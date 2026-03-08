import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { GlassCard } from '../../components/GlassCard';
import { useAppTheme } from '../../context/ThemeContext';
import { getVisualMatchDisplay } from '../../utils/visualMatch';

type ItemDetailNavigationProp = StackNavigationProp<RootStackParamList, 'ItemDetail'>;
type ItemDetailRouteProp = RouteProp<RootStackParamList, 'ItemDetail'>;

const ItemDetailScreen = () => {
  const navigation = useNavigation<ItemDetailNavigationProp>();
  const route = useRoute<ItemDetailRouteProp>();
  const { foundItem } = route.params;
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [showTipsModal, setShowTipsModal] = useState(false);
  const visualMatch = getVisualMatchDisplay(foundItem.imageMatch?.score);

  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      setShowTipsModal(false);
    });

    return unsubscribe;
  }, [navigation]);

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

  const handleProceedToVerification = () => {
    setShowTipsModal(false);
    requestAnimationFrame(() => {
      navigation.navigate('AnswerQuestionsVideo', { foundItem });
    });
  };

  return (
    <LinearGradient colors={theme.gradients.appBackground} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GlassCard style={styles.mediaCard} contentStyle={styles.mediaCardContent}>
          <Image source={{ uri: foundItem.imageUrl }} style={styles.heroImage} contentFit="cover" />

          <View style={styles.badgeRow}>
            <View style={[styles.statusBadge, getStatusBadgeStyle(theme, foundItem.status)]}>
              <Text style={styles.statusText}>{formatStatus(foundItem.status)}</Text>
            </View>

            {visualMatch ? (
              <View
                style={[
                  styles.matchBadge,
                  { backgroundColor: getMatchBadgeColors(theme, visualMatch.normalizedScore).backgroundColor },
                ]}
              >
                <Text
                  style={[
                    styles.matchBadgeText,
                    { color: getMatchBadgeColors(theme, visualMatch.normalizedScore).textColor },
                  ]}
                >
                  {visualMatch.label}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.eyebrow}>Reported item</Text>
          <Text style={styles.title}>{foundItem.category}</Text>
          <Text style={styles.description}>{foundItem.description}</Text>
        </GlassCard>

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
              })}
            </Text>
          </GlassCard>
        </View>

        {visualMatch ? (
          <GlassCard style={styles.detailCard}>
            <Text style={styles.sectionEyebrow}>Visual similarity</Text>
            <Text style={styles.sectionTitle}>{visualMatch.percentage}% likely match</Text>
            <Text style={styles.sectionBody}>
              This result was strengthened by the reference image you provided during search.
            </Text>
          </GlassCard>
        ) : null}

        <GlassCard style={styles.detailCard}>
          <Text style={styles.sectionEyebrow}>Verification step</Text>
          <Text style={styles.sectionTitle}>Answer the founder&apos;s ownership questions</Text>
          <Text style={styles.sectionBody}>
            Record one short clip per question. Contact details stay hidden until the verification result is processed.
          </Text>
        </GlassCard>

        <View style={styles.ctaBlock}>
          <PrimaryButton title="Answer Ownership Questions" onPress={() => setShowTipsModal(true)} size="lg" />
          <Text style={styles.noteText}>Use a clear voice and a steady camera for the best verification result.</Text>
        </View>
      </ScrollView>

      <Modal visible={showTipsModal} transparent animationType="slide" onRequestClose={() => setShowTipsModal(false)}>
        <View style={styles.modalOverlay}>
          <GlassCard style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>Before you start</Text>
            <Text style={styles.modalTitle}>Keep each clip short, clear, and specific.</Text>
            {[
              'Look directly at the camera.',
              'Speak clearly and keep answers concise.',
              'Use a quiet, well-lit environment.',
              'Mention details only the true owner would know.',
            ].map((tip) => (
              <View key={tip} style={styles.tipRow}>
                <View style={styles.tipDot} />
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
            <View style={styles.modalActions}>
              <PrimaryButton title="Cancel" onPress={() => setShowTipsModal(false)} variant="secondary" />
              <PrimaryButton title="Proceed" onPress={handleProceedToVerification} />
            </View>
          </GlassCard>
        </View>
      </Modal>
    </LinearGradient>
  );
};

const formatStatus = (status: string) =>
  status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const getStatusBadgeStyle = (theme: ReturnType<typeof useAppTheme>['theme'], status: string) => {
  switch (status) {
    case 'available':
      return { backgroundColor: theme.colors.success };
    case 'pending_verification':
      return { backgroundColor: theme.colors.warning };
    case 'claimed':
      return { backgroundColor: theme.colors.textSubtle };
    default:
      return { backgroundColor: theme.colors.textMuted };
  }
};

const getMatchBadgeColors = (theme: ReturnType<typeof useAppTheme>['theme'], score: number) => {
  if (score >= 0.8) {
    return { backgroundColor: theme.colors.successSoft, textColor: theme.colors.success };
  }

  if (score >= 0.6) {
    return { backgroundColor: theme.colors.warningSoft, textColor: theme.colors.warning };
  }

  return { backgroundColor: theme.colors.cardMuted, textColor: theme.colors.textMuted };
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
    },
    mediaCard: {
      marginBottom: theme.spacing.md,
    },
    mediaCardContent: {
      padding: 0,
    },
    heroImage: {
      width: '100%',
      height: 280,
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
      backgroundColor: theme.colors.inputMuted,
    },
    badgeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.md,
      marginBottom: theme.spacing.sm,
    },
    statusBadge: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 6,
    },
    statusText: {
      ...theme.type.caption,
      color: theme.colors.inverse,
      fontWeight: '700',
      textTransform: 'uppercase',
    },
    matchBadge: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 6,
    },
    matchBadgeText: {
      ...theme.type.caption,
      fontWeight: '700',
    },
    eyebrow: {
      ...theme.type.label,
      color: theme.colors.accent,
      paddingHorizontal: theme.spacing.md,
      marginBottom: theme.spacing.xs,
    },
    title: {
      ...theme.type.hero,
      color: theme.colors.textStrong,
      textTransform: 'capitalize',
      paddingHorizontal: theme.spacing.md,
      marginBottom: theme.spacing.sm,
    },
    description: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      paddingHorizontal: theme.spacing.md,
      paddingBottom: theme.spacing.md,
    },
    metaGrid: {
      gap: theme.spacing.md,
      marginBottom: theme.spacing.md,
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
    detailCard: {
      marginBottom: theme.spacing.md,
    },
    sectionEyebrow: {
      ...theme.type.label,
      color: theme.colors.accent,
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
    },
    ctaBlock: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
    },
    noteText: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
      textAlign: 'center',
      paddingHorizontal: theme.spacing.md,
    },
    modalOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: theme.colors.overlay,
      padding: theme.spacing.md,
    },
    modalCard: {
      marginBottom: theme.spacing.md,
    },
    modalEyebrow: {
      ...theme.type.label,
      color: theme.colors.accent,
      marginBottom: theme.spacing.xs,
    },
    modalTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.lg,
    },
    tipRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    tipDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.accent,
      marginTop: 7,
    },
    tipText: {
      ...theme.type.body,
      flex: 1,
      color: theme.colors.textMuted,
    },
    modalActions: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
  });

export default ItemDetailScreen;
