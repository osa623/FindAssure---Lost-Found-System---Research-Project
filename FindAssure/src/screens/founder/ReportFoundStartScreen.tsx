import React, { useLayoutEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as ImagePicker from 'expo-image-picker';
import { LoadingScreen } from '../../components/LoadingScreen';
import { GlassCard } from '../../components/GlassCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { RootStackParamList, SelectedImageAsset } from '../../types/models';
import { itemsApi } from '../../api/itemsApi';
import { ITEM_CATEGORIES } from '../../constants/appConstants';
import { gradients, palette, radius, spacing, type } from '../../theme/designSystem';

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
  const isSubmitting = useRef(false);

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
    const matchedCategory = ITEM_CATEGORIES.find((category) => category.trim().toLowerCase() === normalized);
    return matchedCategory || undefined;
  };

  const handleNext = async () => {
    if (isSubmitting.current) return;
    if (images.length === 0) {
      Alert.alert('Image Required', 'Please add at least one image first');
      return;
    }

    try {
      isSubmitting.current = true;
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
      isSubmitting.current = false;
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
    <LinearGradient colors={gradients.appBackground} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <LinearGradient colors={gradients.hero} style={styles.hero}>
          <Text style={styles.heroEyebrow}>Founder flow</Text>
          <Text style={styles.heroTitle}>Start with photos.</Text>
          <Text style={styles.heroBody}>
            Add one to three images. Clear multi-angle photos lead to stronger analysis and better future matches.
          </Text>
        </LinearGradient>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Image set</Text>
          <Text style={styles.sectionTitle}>Capture the item from its best angles</Text>
          <View style={styles.grid}>
            {Array.from({ length: MAX_IMAGES }).map((_, index) => {
              const image = images[index];
              return (
                <View key={index} style={styles.slot}>
                  {image ? (
                    <>
                      <Image source={{ uri: image.uri }} style={styles.image} contentFit="cover" />
                      <Pressable style={styles.removeButton} onPress={() => handleRemoveImage(image.uri)}>
                        <Text style={styles.removeButtonText}>Remove</Text>
                      </Pressable>
                    </>
                  ) : (
                    <View style={styles.placeholder}>
                      <Text style={styles.placeholderIcon}>＋</Text>
                      <Text style={styles.placeholderText}>Photo {index + 1}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
          <Text style={styles.helperText}>
            {images.length <= 1
              ? 'One clear photo enables the basic analysis path.'
              : 'Two or three photos improve multi-view analysis and matching quality.'}
          </Text>
        </GlassCard>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Capture options</Text>
          <Text style={styles.sectionTitle}>Bring in fresh photos or use your gallery</Text>
          <View style={styles.buttonGroup}>
            <PrimaryButton title="Capture Photo" onPress={handleCaptureImage} />
            <PrimaryButton title="Select from Gallery" onPress={handleSelectImages} variant="secondary" />
          </View>
        </GlassCard>

        <PrimaryButton title="Next" onPress={handleNext} disabled={images.length === 0} size="lg" />
      </ScrollView>
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
  heroEyebrow: {
    ...type.label,
    color: 'rgba(255,255,255,0.72)',
    marginBottom: spacing.sm,
  },
  heroTitle: {
    ...type.title,
    color: palette.paperStrong,
    marginBottom: spacing.sm,
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
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  slot: {
    flex: 1,
  },
  image: {
    width: '100%',
    height: 148,
    borderRadius: radius.md,
    backgroundColor: palette.shell,
  },
  placeholder: {
    height: 148,
    borderRadius: radius.md,
    backgroundColor: palette.paperStrong,
    borderWidth: 1,
    borderColor: palette.line,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderIcon: {
    ...type.section,
    color: palette.primaryDeep,
    marginBottom: spacing.xs,
  },
  placeholderText: {
    ...type.caption,
  },
  removeButton: {
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
  removeButtonText: {
    ...type.caption,
    color: palette.danger,
    fontWeight: '700',
  },
  helperText: {
    ...type.body,
  },
  buttonGroup: {
    gap: spacing.sm,
  },
});

export default ReportFoundStartScreen;
