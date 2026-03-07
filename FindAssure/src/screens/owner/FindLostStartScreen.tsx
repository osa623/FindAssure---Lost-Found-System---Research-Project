import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as ImagePicker from 'expo-image-picker';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { RootStackParamList, SelectedImageAsset } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { CategoryPicker } from '../../components/CategoryPicker';
import { LocationPicker } from '../../components/LocationPicker';
import { LocationDetail } from '../../constants/locationData';
import { itemsApi } from '../../api/itemsApi';
import { ITEM_CATEGORIES } from '../../constants/appConstants';
import { AI_BACKEND_URL } from '../../config/api.config';

type FindLostStartNavigationProp = StackNavigationProp<RootStackParamList, 'FindLostStart'>;

const FindLostStartScreen = () => {
  const navigation = useNavigation<FindLostStartNavigationProp>();
  const { user } = useAuth();

  const [category, setCategory] = useState<string>(ITEM_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<LocationDetail | null>(null);
  const [confidenceStage, setConfidenceStage] = useState<number>(2);
  const [ownerImage, setOwnerImage] = useState<SelectedImageAsset | null>(null);
  const [loading, setLoading] = useState(false);

  const [grammarChecking, setGrammarChecking] = useState(false);
  const [grammarNote, setGrammarNote] = useState<string | null>(null);
  const grammarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerGrammarCheck = useCallback((text: string) => {
    if (grammarTimer.current) clearTimeout(grammarTimer.current);
    setGrammarNote(null);

    if (!text || text.trim().length < 5) return;

    grammarTimer.current = setTimeout(async () => {
      setGrammarChecking(true);
      try {
        const res = await axios.post(`${AI_BACKEND_URL}/correct-grammar`, { text }, { timeout: 10000 });
        if (res.data.was_corrected && res.data.corrected_text) {
          setDescription(res.data.corrected_text);
          const fixes = res.data.corrections?.length
            ? res.data.corrections.join(', ')
            : 'Grammar auto-corrected';
          setGrammarNote(fixes);
          setTimeout(() => setGrammarNote(null), 4000);
        }
      } catch {
        // Ignore grammar service failures.
      } finally {
        setGrammarChecking(false);
      }
    }, 1200);
  }, []);

  const handleDescriptionChange = useCallback((text: string) => {
    setDescription(text);
    triggerGrammarCheck(text);
  }, [triggerGrammarCheck]);

  const handleSelectOwnerImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photo library');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setOwnerImage({
        uri: asset.uri,
        fileName: asset.fileName || null,
        mimeType: asset.mimeType || null,
      });
    }
  };

  const handleSearch = async () => {
    if (!user) {
      Alert.alert('Login Required', 'Please login to search for lost items', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => navigation.navigate('Login') },
      ]);
      return;
    }

    if (!category || !description.trim() || !location || !location.location) {
      Alert.alert('Required Fields', 'Please fill in all fields');
      return;
    }

    try {
      setLoading(true);

      const lostRequestResponse = await itemsApi.reportLostItem({
        category,
        description: description.trim(),
        owner_location: location.location,
        floor_id: location.floor_id,
        hall_name: location.hall_name,
        owner_location_confidence_stage: confidenceStage,
        ownerImage,
      });

      navigation.navigate('FindLostResults', {
        foundItems: lostRequestResponse.results || [],
      });
    } catch (error: any) {
      Alert.alert(
        'Search Failed',
        error.message || 'Could not search for items. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Find Your Lost Item</Text>
            <Text style={styles.subtitle}>
              Search through reported found items using description, location, and optionally a photo.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Category *</Text>
              <CategoryPicker
                selectedValue={category}
                onValueChange={setCategory}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Description *</Text>
              <View>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Describe your lost item in detail..."
                  value={description}
                  onChangeText={handleDescriptionChange}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                />
                {grammarChecking && (
                  <View style={styles.grammarIndicator}>
                    <ActivityIndicator size="small" color="#4A90D9" />
                    <Text style={styles.grammarCheckingText}>Checking grammar...</Text>
                  </View>
                )}
              </View>
              {grammarNote ? (
                <Text style={styles.grammarNote}>✓ {grammarNote}</Text>
              ) : (
                <Text style={styles.helperText}>
                  Include color, brand, and specific identifying details.
                </Text>
              )}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Lost Location *</Text>
              <LocationPicker
                selectedValue={location}
                onValueChange={setLocation}
                allowDoNotRemember={true}
                userType="owner"
                error={!location ? undefined : ''}
              />
              <Text style={styles.helperText}>
                Select the location where you think you lost the item.
              </Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>How sure are you about this location?</Text>
              <View style={styles.confidenceContainer}>
                <TouchableOpacity
                  style={[
                    styles.confidenceCard,
                    confidenceStage === 1 && styles.confidenceCardActive,
                    confidenceStage === 1 && { backgroundColor: '#E8F5E9', borderColor: '#4CAF50' },
                  ]}
                  onPress={() => setConfidenceStage(1)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.confidenceEmoji}>😊</Text>
                  <Text style={[styles.confidenceTitle, confidenceStage === 1 && { color: '#4CAF50', fontWeight: '700' }]}>
                    Pretty Sure
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.confidenceCard,
                    confidenceStage === 2 && styles.confidenceCardActive,
                    confidenceStage === 2 && { backgroundColor: '#E3F2FD', borderColor: '#2196F3' },
                  ]}
                  onPress={() => setConfidenceStage(2)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.confidenceEmoji}>🙂</Text>
                  <Text style={[styles.confidenceTitle, confidenceStage === 2 && { color: '#2196F3', fontWeight: '700' }]}>
                    Sure
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.confidenceCard,
                    confidenceStage === 3 && styles.confidenceCardActive,
                    confidenceStage === 3 && { backgroundColor: '#FFF3E0', borderColor: '#FF9800' },
                  ]}
                  onPress={() => setConfidenceStage(3)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.confidenceEmoji}>🤔</Text>
                  <Text style={[styles.confidenceTitle, confidenceStage === 3 && { color: '#FF9800', fontWeight: '700' }]}>
                    Not Sure
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.confidenceCard,
                    confidenceStage === 4 && styles.confidenceCardActive,
                    confidenceStage === 4 && { backgroundColor: '#FFEBEE', borderColor: '#F44336' },
                  ]}
                  onPress={() => setConfidenceStage(4)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.confidenceEmoji}>😕</Text>
                  <Text style={[styles.confidenceTitle, confidenceStage === 4 && { color: '#F44336', fontWeight: '700' }]}>
                    Don&apos;t Remember
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.photoSection}>
              <Text style={styles.label}>Have a photo of your item? (Optional)</Text>
              {ownerImage ? (
                <View style={styles.ownerImageWrap}>
                  <Image
                    source={{ uri: ownerImage.uri }}
                    style={styles.ownerImagePreview}
                    resizeMode="contain"
                  />
                  <TouchableOpacity onPress={() => setOwnerImage(null)}>
                    <Text style={styles.removePhotoText}>Remove photo</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.uploadCard} onPress={handleSelectOwnerImage}>
                  <Text style={styles.uploadCardIcon}>📷</Text>
                  <Text style={styles.uploadCardText}>Upload Photo</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.helperText}>
                Adding a photo improves matching accuracy.
              </Text>
            </View>

            <PrimaryButton
              title="Search Found Items"
              onPress={handleSearch}
              loading={loading}
              style={styles.searchButton}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 20,
  },
  form: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#DDDDDD',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#FAFAFA',
  },
  textArea: {
    minHeight: 120,
    paddingTop: 12,
  },
  helperText: {
    fontSize: 12,
    color: '#999999',
    marginTop: 6,
  },
  grammarIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'absolute',
    bottom: 8,
    right: 8,
  },
  grammarCheckingText: {
    fontSize: 11,
    color: '#4A90D9',
    marginLeft: 4,
  },
  grammarNote: {
    fontSize: 12,
    color: '#4CAF50',
    marginTop: 6,
    fontWeight: '500',
  },
  confidenceContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  confidenceCard: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E0E0E0',
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confidenceCardActive: {
    borderWidth: 3,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  confidenceEmoji: {
    fontSize: 32,
    marginBottom: 8,
  },
  confidenceTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666666',
    textAlign: 'center',
  },
  photoSection: {
    marginBottom: 20,
  },
  uploadCard: {
    height: 110,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C8D2E0',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F7FAFD',
  },
  uploadCardIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  uploadCardText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#355D7A',
  },
  ownerImageWrap: {
    alignItems: 'flex-start',
  },
  ownerImagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: '#E0E0E0',
  },
  removePhotoText: {
    marginTop: 8,
    fontSize: 12,
    color: '#C62828',
    fontWeight: '600',
  },
  searchButton: {
    marginTop: 10,
  },
});

export default FindLostStartScreen;
