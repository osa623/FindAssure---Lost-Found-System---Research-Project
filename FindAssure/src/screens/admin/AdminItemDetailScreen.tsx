// AdminItemDetailScreen – follow the spec (admin can see EVERYTHING including founderAnswers)
import React, { useState } from 'react';
import { 
  View, 
  Text, 
  Image, 
  StyleSheet, 
  ScrollView, 
  Alert,
  TouchableOpacity
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { itemsApi } from '../../api/itemsApi';

type AdminItemDetailNavigationProp = StackNavigationProp<RootStackParamList, 'AdminItemDetail'>;
type AdminItemDetailRouteProp = RouteProp<RootStackParamList, 'AdminItemDetail'>;

const AdminItemDetailScreen = () => {
  const navigation = useNavigation<AdminItemDetailNavigationProp>();
  const route = useRoute<AdminItemDetailRouteProp>();
  const { foundItem } = route.params;

  const [currentStatus, setCurrentStatus] = useState(foundItem.status);
  const [loading, setLoading] = useState(false);

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

  const handleChangeStatus = async (newStatus: string) => {
    Alert.alert(
      'Confirm Status Change',
      `Change status to "${newStatus}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            try {
              setLoading(true);
              await itemsApi.updateFoundItemStatus(foundItem._id, newStatus);
              setCurrentStatus(newStatus as any);
              Alert.alert('Success', 'Status updated successfully');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to update status');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Image source={{ uri: foundItem.imageUrl }} style={styles.image} />

        <View style={styles.card}>
          <View style={styles.adminBadge}>
            <Text style={styles.adminBadgeText}>ADMIN VIEW</Text>
          </View>

          <View style={styles.statusSection}>
            <Text style={styles.label}>Current Status:</Text>
            <View style={[styles.statusBadge, getStatusBadgeStyle(currentStatus)]}>
              <Text style={styles.statusText}>{currentStatus}</Text>
            </View>
          </View>

          <Text style={styles.category}>{foundItem.category}</Text>
          
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.description}>{foundItem.description}</Text>
          </View>

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
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>👤 Founder Contact Information</Text>
            <View style={styles.contactInfo}>
              <Text style={styles.contactLabel}>Name:</Text>
              <Text style={styles.contactValue}>{foundItem.founderContact?.name || 'N/A'}</Text>
            </View>
            <View style={styles.contactInfo}>
              <Text style={styles.contactLabel}>Email:</Text>
              <Text style={styles.contactValue}>{foundItem.founderContact?.email || 'N/A'}</Text>
            </View>
            <View style={styles.contactInfo}>
              <Text style={styles.contactLabel}>Phone:</Text>
              <Text style={styles.contactValue}>{foundItem.founderContact?.phone || 'N/A'}</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>❓ Questions & Founder Answers</Text>
            <Text style={styles.adminNote}>
              ⚠️ Admin can see founder&apos;s answers - DO NOT share with unverified users
            </Text>
            {foundItem.questions.map((question, index) => (
              <View key={index} style={styles.qaItem}>
                <Text style={styles.questionNumber}>Q{index + 1}:</Text>
                <View style={styles.qaContent}>
                  <Text style={styles.questionText}>{question}</Text>
                  <View style={styles.answerBox}>
                    <Text style={styles.answerLabel}>Founder&apos;s Answer:</Text>
                    <Text style={styles.answerText}>{foundItem.founderAnswers?.[index] || 'N/A'}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>⚙️ Change Status</Text>
            <View style={styles.statusButtons}>
              <TouchableOpacity
                style={[styles.statusButton, styles.statusButtonAvailable]}
                onPress={() => handleChangeStatus('available')}
                disabled={loading || currentStatus === 'available'}
              >
                <Text style={styles.statusButtonText}>Available</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusButton, styles.statusButtonPending]}
                onPress={() => handleChangeStatus('pending_verification')}
                disabled={loading || currentStatus === 'pending_verification'}
              >
                <Text style={styles.statusButtonText}>Pending</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusButton, styles.statusButtonClaimed]}
                onPress={() => handleChangeStatus('claimed')}
                disabled={loading || currentStatus === 'claimed'}
              >
                <Text style={styles.statusButtonText}>Claimed</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.metadataSection}>
            <Text style={styles.metadataLabel}>Item ID: {foundItem._id}</Text>
            {foundItem.updatedAt && (
              <Text style={styles.metadataLabel}>
                Last Updated: {new Date(foundItem.updatedAt).toLocaleString()}
              </Text>
            )}
          </View>
        </View>
      </View>
    </ScrollView>
  );
};

const getStatusBadgeStyle = (status: string) => {
  switch (status) {
    case 'available':
      return { backgroundColor: '#4CAF50' };
    case 'pending_verification':
      return { backgroundColor: '#FF9800' };
    case 'claimed':
      return { backgroundColor: '#9E9E9E' };
    default:
      return { backgroundColor: '#757575' };
  }
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
  adminBadge: {
    backgroundColor: '#E53935',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  adminBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  statusSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666666',
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
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
  contactInfo: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  contactLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666666',
    width: 60,
  },
  contactValue: {
    flex: 1,
    fontSize: 14,
    color: '#333333',
  },
  adminNote: {
    fontSize: 12,
    color: '#E53935',
    backgroundColor: '#FFEBEE',
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
  },
  qaItem: {
    flexDirection: 'row',
    marginBottom: 16,
    backgroundColor: '#F8F9FA',
    padding: 12,
    borderRadius: 8,
  },
  questionNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4A90E2',
    marginRight: 8,
    minWidth: 30,
  },
  qaContent: {
    flex: 1,
  },
  questionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 8,
  },
  answerBox: {
    backgroundColor: '#E3F2FD',
    padding: 10,
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#4A90E2',
  },
  answerLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1565C0',
    marginBottom: 4,
  },
  answerText: {
    fontSize: 13,
    color: '#333333',
    lineHeight: 18,
  },
  statusButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  statusButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    elevation: 2,
  },
  statusButtonAvailable: {
    backgroundColor: '#4CAF50',
  },
  statusButtonPending: {
    backgroundColor: '#FF9800',
  },
  statusButtonClaimed: {
    backgroundColor: '#9E9E9E',
  },
  statusButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  metadataSection: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  metadataLabel: {
    fontSize: 11,
    color: '#999999',
    marginBottom: 4,
  },
});

export default AdminItemDetailScreen;
