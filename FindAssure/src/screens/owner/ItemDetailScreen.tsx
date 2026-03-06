// ItemDetailScreen – follow the spec (IMPORTANT: DO NOT show founderAnswers)
import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, Modal, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';

type ItemDetailNavigationProp = StackNavigationProp<RootStackParamList, 'ItemDetail'>;
type ItemDetailRouteProp = RouteProp<RootStackParamList, 'ItemDetail'>;

const ItemDetailScreen = () => {
  const navigation = useNavigation<ItemDetailNavigationProp>();
  const route = useRoute<ItemDetailRouteProp>();
  const { foundItem } = route.params;
  const [showTipsModal, setShowTipsModal] = useState(false);

  const handleAnswerQuestions = () => {
    setShowTipsModal(true);
  };

  const handleProceedToQuestions = () => {
    setShowTipsModal(false);
    navigation.navigate('AnswerQuestionsVideo', { foundItem });
  };

  const handleCloseTips = () => {
    setShowTipsModal(false);
  };

  // Format location display
  const formatLocation = (locations: typeof foundItem.found_location) => {
    if (!locations || locations.length === 0) return 'Location not specified';
    
    return locations.map((loc, index) => {
      let locationStr = loc.location;
      if (loc.floor_id) locationStr += ` - Floor: ${loc.floor_id}`;
      if (loc.hall_name) locationStr += ` - Hall: ${loc.hall_name}`;
      return locationStr;
    }).join('\n');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Image source={{ uri: foundItem.imageUrl }} style={styles.image} />

        <View style={styles.card}>
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{foundItem.status}</Text>
          </View>

          <Text style={styles.category}>{foundItem.category}</Text>
          
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.description}>{foundItem.description}</Text>
          </View>

          {foundItem.imageMatch && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Visual Similarity</Text>
              <View style={styles.visualMatchCard}>
                <Image source={{ uri: foundItem.imageUrl }} style={styles.visualMatchImage} />
                <Text style={styles.visualMatchText}>
                  {`Visual Similarity: ${Math.round(foundItem.imageMatch.score * 100)}%`}
                </Text>
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📍 Found Location</Text>
            <Text style={styles.locationText}>{formatLocation(foundItem.found_location)}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📅 Date Found</Text>
            <Text style={styles.dateText}>
              {new Date(foundItem.createdAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </View>
        </View>

        <View style={styles.actionSection}>
          <PrimaryButton
            title="Answer Ownership Questions"
            onPress={handleAnswerQuestions}
            style={styles.button}
          />
          <Text style={styles.actionNote}>
            After verification, you'll be able to contact the founder
          </Text>
        </View>
      </View>

      {/* Tips Modal */}
      <Modal
        visible={showTipsModal}
        transparent
        animationType="slide"
        onRequestClose={handleCloseTips}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalIcon}>📹</Text>
              <Text style={styles.modalTitle}>Important Tips Before You Start</Text>
              <Text style={styles.modalSubtitle}>Follow these guidelines for successful verification</Text>
            </View>

            <ScrollView style={styles.tipsScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.tipCard}>
                <View style={styles.tipIconContainer}>
                  <Text style={styles.tipIcon}>👀</Text>
                </View>
                <View style={styles.tipContent}>
                  <Text style={styles.tipTitle}>Look at the Camera</Text>
                  <Text style={styles.tipText}>Face the camera directly and maintain eye contact while recording</Text>
                </View>
              </View>

              <View style={styles.tipCard}>
                <View style={styles.tipIconContainer}>
                  <Text style={styles.tipIcon}>🗣️</Text>
                </View>
                <View style={styles.tipContent}>
                  <Text style={styles.tipTitle}>Speak Clearly</Text>
                  <Text style={styles.tipText}>Give your answers in clear English with proper pronunciation</Text>
                </View>
              </View>

              <View style={styles.tipCard}>
                <View style={styles.tipIconContainer}>
                  <Text style={styles.tipIcon}>⏱️</Text>
                </View>
                <View style={styles.tipContent}>
                  <Text style={styles.tipTitle}>Keep It Short</Text>
                  <Text style={styles.tipText}>Maximum video length is 5 seconds per answer - be concise</Text>
                </View>
              </View>

              <View style={styles.tipCard}>
                <View style={styles.tipIconContainer}>
                  <Text style={styles.tipIcon}>🔊</Text>
                </View>
                <View style={styles.tipContent}>
                  <Text style={styles.tipTitle}>Quiet Environment</Text>
                  <Text style={styles.tipText}>Record in a quiet place to ensure your voice is heard clearly</Text>
                </View>
              </View>

              <View style={styles.tipCard}>
                <View style={styles.tipIconContainer}>
                  <Text style={styles.tipIcon}>💡</Text>
                </View>
                <View style={styles.tipContent}>
                  <Text style={styles.tipTitle}>Good Lighting</Text>
                  <Text style={styles.tipText}>Ensure your face is well-lit and clearly visible</Text>
                </View>
              </View>

              <View style={styles.tipCard}>
                <View style={styles.tipIconContainer}>
                  <Text style={styles.tipIcon}>✓</Text>
                </View>
                <View style={styles.tipContent}>
                  <Text style={styles.tipTitle}>Be Specific & Accurate</Text>
                  <Text style={styles.tipText}>Provide detailed answers that only the true owner would know</Text>
                </View>
              </View>

              <View style={styles.noteBox}>
                <Text style={styles.noteIcon}>ℹ️</Text>
                <Text style={styles.noteText}>
                  You can preview and retake your videos before final submission.
                  Alternatively, you can type your answers if you prefer.
                </Text>
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={styles.cancelButton}
                onPress={handleCloseTips}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.proceedButton}
                onPress={handleProceedToQuestions}
              >
                <Text style={styles.proceedButtonText}>I Understand, Proceed</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  content: {
    paddingBottom: 30,
  },
  image: {
    width: '100%',
    height: 300,
    backgroundColor: '#E0E0E0',
  },
  card: {
    backgroundColor: '#FFFFFF',
    margin: 20,
    marginTop: -40,
    borderRadius: 16,
    padding: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#4CAF50',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 12,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  category: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 20,
    textTransform: 'capitalize',
  },
  section: {
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    color: '#666666',
    lineHeight: 22,
  },
  locationText: {
    fontSize: 15,
    color: '#4A90E2',
    fontWeight: '500',
  },
  dateText: {
    fontSize: 15,
    color: '#666666',
  },
  visualMatchCard: {
    backgroundColor: '#F6F8FB',
    borderRadius: 12,
    padding: 12,
  },
  visualMatchImage: {
    width: '100%',
    height: 180,
    borderRadius: 10,
    backgroundColor: '#E0E0E0',
    marginBottom: 10,
  },
  visualMatchText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2B4B64',
  },
  actionSection: {
    paddingHorizontal: 20,
  },
  button: {
    marginBottom: 12,
  },
  actionNote: {
    fontSize: 13,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 18,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingTop: 24,
  },
  modalHeader: {
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  modalIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  tipsScroll: {
    paddingHorizontal: 20,
    maxHeight: 400,
  },
  tipCard: {
    flexDirection: 'row',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#4A90E2',
  },
  tipIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  tipIcon: {
    fontSize: 20,
  },
  tipContent: {
    flex: 1,
  },
  tipTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  tipText: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
  noteBox: {
    flexDirection: 'row',
    backgroundColor: '#FFF9E6',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#FFC107',
  },
  noteIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
  },
  proceedButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#4A90E2',
    alignItems: 'center',
  },
  proceedButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default ItemDetailScreen;
