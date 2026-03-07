import React, { useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Alert, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as ImagePicker from 'expo-image-picker';
import { LoadingScreen } from '../../components/LoadingScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { RootStackParamList, SelectedImageAsset } from '../../types/models';
import { itemsApi } from '../../api/itemsApi';
import { ITEM_CATEGORIES } from '../../constants/appConstants';

type ReportFoundStartNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundStart'>;

const MAX_IMAGES = 3;

const mapPickerAsset = (asset: ImagePicker.ImagePickerAsset): SelectedImageAsset => ({
  uri: asset.uri,
  fileName: asset.fileName || null,
  mimeType: asset.mimeType || null,
});

const mergeImages = (current: SelectedImageAsset[], incoming: SelectedImageAsset[]) => {
  const merged = [...current];

  for (const image of incoming) {
    if (!merged.find((item) => item.uri === image.uri)) {
      merged.push(image);
    }
  }

  return merged.slice(0, MAX_IMAGES);
};

const ReportFoundStartScreen = () => {
  const navigation = useNavigation<ReportFoundStartNavigationProp>();
  const [images, setImages] = useState<SelectedImageAsset[]>([]);
  const [loading, setLoading] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      gestureEnabled: !loading,
      headerLeft: loading ? () => null : undefined,
    });
  }, [loading, navigation]);

  const requestLibraryPermissions = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photo library');
      return false;
    }
    return true;
  };

  const handleSelectImages = async () => {
    const hasPermission = await requestLibraryPermissions();
    if (!hasPermission) return;

    const remainingSlots = MAX_IMAGES - images.length;
    if (remainingSlots <= 0) {
      Alert.alert('Image Limit Reached', 'You can upload up to 3 photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: remainingSlots,
      quality: 0.8,
    });

    if (!result.canceled) {
      setImages((current) => mergeImages(current, result.assets.map(mapPickerAsset)));
    }
  };

  const handleCaptureImage = async () => {
    if (images.length >= MAX_IMAGES) {
      Alert.alert('Image Limit Reached', 'You can upload up to 3 photos.');
      return;
    }

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your camera');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled) {
      setImages((current) => mergeImages(current, [mapPickerAsset(result.assets[0])]));
    }
  };

  const handleRemoveImage = (uri: string) => {
    setImages((current) => current.filter((image) => image.uri !== uri));
  };

  const normalizeDetectedCategory = (detectedCategory?: string | null): string | undefined => {
    if (!detectedCategory) return undefined;

    const normalized = detectedCategory.trim().toLowerCase();
    const matchedCategory = ITEM_CATEGORIES.find(
      (category) => category.trim().toLowerCase() === normalized
    );

    return matchedCategory || undefined;
  };

  const handleNext = async () => {
    if (loading) {
      return;
    }

    if (images.length === 0) {
      Alert.alert('Image Required', 'Please add at least one image first');
      return;
    }

    try {
      setLoading(true);

      const preAnalysis = await itemsApi.preAnalyzeFoundImages(images);

      navigation.navigate('ReportFoundDetails', {
        images,
        preAnalysisToken: preAnalysis.preAnalysisToken || null,
        category: normalizeDetectedCategory(preAnalysis.detectedCategory),
        description: preAnalysis.detectedDescription || undefined,
        analysisMessage: preAnalysis.message || undefined,
      });
    } catch (error: any) {
      navigation.navigate('ReportFoundDetails', {
        images,
        preAnalysisToken: null,
        analysisMessage: error?.message || 'Image analysis unavailable. Please enter details manually.',
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <LoadingScreen
        message="Analyzing your photos..."
        subtitle="This may take a few seconds while we identify the item and prepare the next step."
      />
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Report a Found Item</Text>
          <Text style={styles.subtitle}>
            Add 1 to 3 photos. One clear photo enables basic analysis, and 2 to 3 angles improve matching.
          </Text>
        </View>

        <View style={styles.grid}>
          {Array.from({ length: MAX_IMAGES }).map((_, index) => {
            const image = images[index];

            return (
              <View key={index} style={styles.slot}>
                {image ? (
                  <>
                    <Image
                      source={{ uri: image.uri }}
                      style={styles.image}
                      resizeMode="contain"
                    />
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={() => handleRemoveImage(image.uri)}
                    >
                      <Text style={styles.removeButtonText}>Remove</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={styles.placeholder}>
                    <Text style={styles.placeholderIcon}>+</Text>
                    <Text style={styles.placeholderText}>Photo {index + 1}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <Text style={styles.helperText}>
          {images.length <= 1
            ? '1 photo = basic analysis for clear, well-lit items.'
            : '2-3 photos = enhanced multi-view analysis from different angles.'}
        </Text>

        <View style={styles.buttonGroup}>
          <PrimaryButton title="Capture Photo" onPress={handleCaptureImage} style={styles.button} />
          <PrimaryButton title="Select from Gallery" onPress={handleSelectImages} style={styles.button} />
        </View>

        <PrimaryButton
          title="Next"
          onPress={handleNext}
          disabled={images.length === 0}
          style={styles.nextButton}
        />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
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
  grid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  slot: {
    flex: 1,
  },
  image: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    backgroundColor: '#E0E0E0',
  },
  placeholder: {
    height: 160,
    borderRadius: 12,
    backgroundColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#CCCCCC',
    borderStyle: 'dashed',
  },
  placeholderIcon: {
    fontSize: 28,
    color: '#777777',
    marginBottom: 8,
  },
  placeholderText: {
    fontSize: 13,
    color: '#777777',
  },
  removeButton: {
    marginTop: 8,
    alignItems: 'center',
  },
  removeButtonText: {
    fontSize: 12,
    color: '#C62828',
    fontWeight: '600',
  },
  helperText: {
    fontSize: 13,
    color: '#666666',
    marginBottom: 20,
  },
  buttonGroup: {
    marginBottom: 16,
  },
  button: {
    marginBottom: 12,
  },
  nextButton: {
    marginBottom: 16,
  },
});

export default ReportFoundStartScreen;
