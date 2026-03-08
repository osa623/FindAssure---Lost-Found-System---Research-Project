import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import { useAppTheme } from '../../context/ThemeContext';
import { resolveItemCategory } from '../../utils/itemCategory';
import { showImageSourceOptions } from '../../utils/imageSourceOptions';

type ReportFoundStartNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundStart'>;

const MAX_IMAGES = 3;
const SINGLE_IMAGE_LOADING_STEPS = [
  {
    title: 'Preparing your photo',
    subtitle: 'Optimizing the image so we can inspect the item clearly.',
  },
  {
    title: 'Analyzing item details',
    subtitle: 'Looking for the category and a useful public description from the photo.',
  },
  {
    title: 'Preparing the next step',
    subtitle: 'Packing the suggested details so you can review before continuing.',
  },
] as const;

const MULTI_IMAGE_LOADING_STEPS = [
  {
    title: 'Preparing your photo set',
    subtitle: 'Organizing the angles so we can compare the item more reliably.',
  },
  {
    title: 'Analyzing item details',
    subtitle: 'Combining multiple views to infer a stronger category and description.',
  },
  {
    title: 'Preparing the next step',
    subtitle: 'Saving the analysis outcome so you can confirm the report details.',
  },
] as const;

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
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [images, setImages] = useState<SelectedImageAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStageIndex, setLoadingStageIndex] = useState(0);
  const isSubmitting = useRef(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      gestureEnabled: !loading,
      headerLeft: loading ? () => null : undefined,
    });
  }, [loading, navigation]);

  useEffect(() => {
    if (!loading) {
      setLoadingStageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setLoadingStageIndex((current) => Math.min(current + 1, 2));
    }, 1800);

    return () => clearInterval(interval);
  }, [loading]);

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
        category: resolveItemCategory(preAnalysis.detectedCategory),
        description: preAnalysis.detectedDescription || undefined,
        analysisMessage: preAnalysis.analysisSummary || preAnalysis.message || undefined,
      });
    } catch (error: any) {
      navigation.navigate('ReportFoundDetails', {
        images,
        preAnalysisToken: null,
        analysisMessage:
          error?.message || 'We could not finish the photo analysis. Continue manually and confirm the details yourself.',
      });
    } finally {
      isSubmitting.current = false;
      setLoading(false);
    }
  };

  if (loading) {
    const loadingSteps = images.length > 1 ? MULTI_IMAGE_LOADING_STEPS : SINGLE_IMAGE_LOADING_STEPS;
    const currentStep = loadingSteps[loadingStageIndex] || loadingSteps[loadingSteps.length - 1];

    return (
      <LoadingScreen
        badge="Photo analysis"
        message={currentStep.title}
        subtitle={currentStep.subtitle}
        stageLabel={`Step ${Math.min(loadingStageIndex + 1, loadingSteps.length)} of ${loadingSteps.length}`}
        note={
          images.length > 1
            ? 'Multi-angle photos can improve matching quality. If we cannot prefill confidently, you can still continue manually.'
            : 'One clear photo can still prefill the report. If confidence is low, you can continue manually.'
        }
        illustrationVariant="auth"
      />
    );
  }

  return (
    <LinearGradient colors={theme.gradients.appBackground} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <LinearGradient colors={theme.gradients.hero} style={styles.hero}>
          <Text style={styles.heroEyebrow}>Report item</Text>
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
                    <View style={styles.imageWrap}>
                      <Image source={{ uri: image.uri }} style={styles.image} contentFit="cover" />
                      <Pressable
                        style={styles.removeButton}
                        onPress={() => handleRemoveImage(image.uri)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove photo ${index + 1}`}
                      >
                        <Ionicons name="close" size={14} color={theme.colors.onTint} />
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      style={styles.placeholder}
                      onPress={() =>
                        showImageSourceOptions({
                          title: `Add Photo ${index + 1}`,
                          onTakePhoto: handleCaptureImage,
                          onChooseFromLibrary: handleSelectImages,
                        })
                      }
                    >
                      <Text style={styles.placeholderIcon}>+</Text>
                      <Text style={styles.placeholderText}>Photo {index + 1}</Text>
                    </Pressable>
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

        <PrimaryButton title="Next" onPress={handleNext} disabled={images.length === 0} size="lg" />
      </ScrollView>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: { flex: 1 },
    content: {
      paddingTop: theme.spacing.lg,
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
    },
    hero: {
      borderRadius: theme.radius.lg,
      padding: theme.spacing.lg,
      marginBottom: theme.spacing.lg,
    },
    heroEyebrow: {
      ...theme.type.label,
      color: theme.colors.onTintSubtle,
      marginBottom: theme.spacing.sm,
    },
    heroTitle: {
      ...theme.type.title,
      color: theme.colors.onTint,
      marginBottom: theme.spacing.sm,
    },
    heroBody: {
      ...theme.type.body,
      color: theme.colors.onTintMuted,
    },
    cardGap: {
      marginBottom: theme.spacing.lg,
    },
    sectionEyebrow: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    sectionTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.md,
    },
    grid: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    slot: {
      flex: 1,
    },
    imageWrap: {
      position: 'relative',
    },
    image: {
      width: '100%',
      height: 148,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.shell,
    },
    placeholder: {
      height: 148,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.card,
      borderWidth: 1,
      borderColor: theme.colors.lineStrong,
      justifyContent: 'center',
      alignItems: 'center',
    },
    placeholderIcon: {
      ...theme.type.section,
      color: theme.colors.primaryDeep,
      marginBottom: theme.spacing.xs,
    },
    placeholderText: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
    },
    removeButton: {
      position: 'absolute',
      top: theme.spacing.sm,
      right: theme.spacing.sm,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: theme.colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
    },
    helperText: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
  });

export default ReportFoundStartScreen;
