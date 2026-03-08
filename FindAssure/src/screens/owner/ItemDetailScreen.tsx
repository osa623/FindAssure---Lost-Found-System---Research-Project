import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { GlassCard } from '../../components/GlassCard';
import { gradients, palette, radius, spacing, type } from '../../theme/designSystem';

type ItemDetailNavigationProp = StackNavigationProp<RootStackParamList, 'ItemDetail'>;
type ItemDetailRouteProp = RouteProp<RootStackParamList, 'ItemDetail'>;

const ItemDetailScreen = () => {
  const navigation = useNavigation<ItemDetailNavigationProp>();
  const route = useRoute<ItemDetailRouteProp>();
  const { foundItem } = route.params;
  const [showTipsModal, setShowTipsModal] = useState(false);

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

  return (
    <LinearGradient colors={gradients.appBackground} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <LinearGradient colors={gradients.heroAlt} style={styles.hero}>
          <Image source={{ uri: foundItem.imageUrl }} style={styles.heroImage} contentFit="cover" />
          <Text style={styles.heroLabel}>{foundItem.status.replace('_', ' ')}</Text>
          <Text style={styles.heroTitle}>{foundItem.category}</Text>
          <Text style={styles.heroBody}>{foundItem.description}</Text>
        </LinearGradient>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Found location</Text>
          <Text style={styles.sectionBody}>{formatLocation(foundItem.found_location)}</Text>
        </GlassCard>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Date found</Text>
          <Text style={styles.sectionBody}>
            {new Date(foundItem.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </Text>
        </GlassCard>

        {foundItem.imageMatch ? (
          <GlassCard style={styles.cardGap}>
            <Text style={styles.sectionEyebrow}>Visual similarity</Text>
            <Text style={styles.sectionTitle}>{Math.round(foundItem.imageMatch.score * 100)}% match</Text>
            <Text style={styles.sectionBody}>This score compares your search image context with the found item image.</Text>
          </GlassCard>
        ) : null}

        <PrimaryButton title="Answer Ownership Questions" onPress={() => setShowTipsModal(true)} size="lg" />
        <Text style={styles.noteText}>After verification, you will be able to contact the founder.</Text>
      </ScrollView>

      <Modal visible={showTipsModal} transparent animationType="slide" onRequestClose={() => setShowTipsModal(false)}>
        <View style={styles.modalOverlay}>
          <GlassCard style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>Before you start</Text>
            <Text style={styles.modalTitle}>Keep the verification clips clean and clear.</Text>
            {[
              'Look directly at the camera.',
              'Speak clearly and keep answers concise.',
              'Use a quiet, well-lit environment.',
              'Be specific about the item details you know.',
            ].map((tip) => (
              <View key={tip} style={styles.tipRow}>
                <View style={styles.tipDot} />
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
            <View style={styles.modalActions}>
              <PrimaryButton title="Cancel" onPress={() => setShowTipsModal(false)} variant="secondary" />
              <PrimaryButton title="Proceed" onPress={() => navigation.navigate('AnswerQuestionsVideo', { foundItem })} />
            </View>
          </GlassCard>
        </View>
      </Modal>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  hero: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroImage: {
    width: '100%',
    height: 220,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    backgroundColor: palette.shell,
  },
  heroLabel: {
    ...type.label,
    color: 'rgba(255,255,255,0.72)',
    marginBottom: spacing.xs,
  },
  heroTitle: {
    ...type.title,
    color: palette.paperStrong,
    marginBottom: spacing.sm,
    textTransform: 'capitalize',
  },
  heroBody: {
    ...type.body,
    color: 'rgba(255,255,255,0.82)',
  },
  cardGap: {
    marginBottom: spacing.lg,
  },
  sectionEyebrow: {
    ...type.label,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    ...type.section,
    marginBottom: spacing.sm,
  },
  sectionBody: {
    ...type.body,
  },
  noteText: {
    ...type.caption,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.28)',
    padding: spacing.md,
  },
  modalCard: {
    marginBottom: spacing.md,
  },
  modalEyebrow: {
    ...type.label,
    marginBottom: spacing.xs,
  },
  modalTitle: {
    ...type.section,
    marginBottom: spacing.lg,
  },
  tipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.primary,
    marginTop: 8,
  },
  tipText: {
    ...type.body,
    flex: 1,
  },
  modalActions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});

export default ItemDetailScreen;
