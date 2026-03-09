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
import {
  FounderImagePreAnalysisResponse,
  RootStackParamList,
  SelectedImageAsset,
} from '../../types/models';
import { itemsApi } from '../../api/itemsApi';
import { useAppTheme } from '../../context/ThemeContext';
import { resolveItemCategory } from '../../utils/itemCategory';
import { showImageSourceOptions } from '../../utils/imageSourceOptions';

type ReportFoundStartNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundStart'>;

const MAX_IMAGES = 3;
const DEFAULT_RETRY_AFTER_MS = 1000;
const TOTAL_ANALYSIS_STEPS = 4;

const ANALYSIS_STAGE_INDEX: Record<string, number> = {
  queued: 1,
  detecting: 2,
  reasoning: 3,
  finalizing: 4,
};

const ANALYSIS_STAGE_COPY: Record<
  string,
  {
    title: string;
    singlePhotoMessage: string;
    multiPhotoMessage: string;
  }
> = {
  queued: {
    title: 'Preparing your photos',
    singlePhotoMessage: 'Getting your single photo ready for inspection.',
    multiPhotoMessage: 'Preparing your multi-view photo set for analysis.',
  },
  detecting: {
    title: 'Scanning the item',
    singlePhotoMessage: 'Inspecting the visible details in your photo.',
    multiPhotoMessage: 'Comparing the uploaded angles to understand the item more reliably.',
  },
  reasoning: {
    title: 'Refining category and description',
    singlePhotoMessage: 'Turning what we see into a useful report suggestion.',
    multiPhotoMessage: 'Combining the views into a stronger category and description suggestion.',
  },
  finalizing: {
    title: 'Preparing the next step',
    singlePhotoMessage: 'Packaging the result so you can review it before continuing.',
    multiPhotoMessage: 'Preparing the final multi-view suggestion for review.',
  },
};

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
  const [loadingState, setLoadingState] = useState<FounderImagePreAnalysisResponse | null>(null);
  const isSubmitting = useRef(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  const loading = Boolean(loadingState);

  useLayoutEffect(() => {
    navigation.setOptions({
      gestureEnabled: !loading,
      headerLeft: loading ? () => null : undefined,
    });
  }, [loading, navigation]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, []);

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

  const clearPolling = () => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  };

  const navigateWithPreAnalysis = (preAnalysis: {
    preAnalysisToken?: string | null;
    detectedCategory?: string | null;
    detectedDescription?: string | null;
    analysisSummary?: string;
    message?: string;
    status?: string;
  }) => {
    const fallbackMessage =
      preAnalysis.status === 'failed'
        ? 'We could not finish the photo analysis. Continue manually and confirm the details yourself.'
        : 'We could not confidently prefill this item. Continue manually.';

    navigation.navigate('ReportFoundDetails', {
      images,
      preAnalysisToken: preAnalysis.preAnalysisToken || null,
      category: resolveItemCategory(preAnalysis.detectedCategory),
      description: preAnalysis.detectedDescription || undefined,
      analysisMessage: preAnalysis.analysisSummary || preAnalysis.message || fallbackMessage,
    });
  };

  const pollFounderPreAnalysis = (taskId: string, retryAfterMs: number) => {
    clearPolling();
    pollTimeoutRef.current = setTimeout(async () => {
      try {
        const statusResponse = await itemsApi.getFounderImagePreAnalysisStatus(taskId);
        if (!isMountedRef.current) {
          return;
        }

        setLoadingState(statusResponse);

        if (statusResponse.status === 'queued' || statusResponse.status === 'processing') {
          pollFounderPreAnalysis(taskId, statusResponse.retryAfterMs || DEFAULT_RETRY_AFTER_MS);
          return;
        }

        clearPolling();
        isSubmitting.current = false;
        setLoadingState(null);
        navigateWithPreAnalysis(statusResponse);
      } catch (error: any) {
        if (!isMountedRef.current) {
          return;
        }
        clearPolling();
        isSubmitting.current = false;
        setLoadingState(null);
        navigateWithPreAnalysis({
          status: 'failed',
          message:
            error?.message ||
            'We could not finish the photo analysis. Continue manually and confirm the details yourself.',
        });
      }
    }, retryAfterMs);
  };

  const handleNext = async () => {
    if (isSubmitting.current) return;
    if (images.length === 0) {
      Alert.alert('Image Required', 'Please add at least one image first');
      return;
    }

    try {
      isSubmitting.current = true;
      setLoadingState({
        status: 'queued',
        imageCount: images.length,
        analysisMode: images.length > 1 ? 'pp2' : 'pp1',
        analysisPathLabel: images.length > 1 ? 'Multi-view analysis' : 'Single photo analysis',
        stageKey: 'queued',
        stageLabel: 'Preparing your photos',
        stageMessage:
          images.length > 1
            ? 'Preparing your multi-view photo set for analysis.'
            : 'Getting your single photo ready for inspection.',
      });

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          setTimeout(resolve, 0);
        });
      });

      const startResponse = await itemsApi.startFounderImagePreAnalysis(images);
      setLoadingState(startResponse);

      if (
        startResponse.status === 'ok'
        || startResponse.status === 'manual_fallback'
        || startResponse.status === 'failed'
      ) {
        setLoadingState(null);
        navigateWithPreAnalysis(startResponse);
        return;
      }

      if (!startResponse.taskId) {
        throw new Error('Image analysis task did not return a task ID.');
      }

      pollFounderPreAnalysis(startResponse.taskId, startResponse.retryAfterMs || DEFAULT_RETRY_AFTER_MS);
    } catch (error: any) {
      setLoadingState(null);
      navigateWithPreAnalysis({
        status: 'failed',
        message:
          error?.message || 'We could not finish the photo analysis. Continue manually and confirm the details yourself.',
      });
    } finally {
      if (!pollTimeoutRef.current) {
        isSubmitting.current = false;
      }
    }
  };

  if (loading) {
    const effectiveImageCount = loadingState?.imageCount || images.length || 1;
    const currentStageKey =
      typeof loadingState?.stageKey === 'string' && loadingState.stageKey.length > 0
        ? loadingState.stageKey
        : loadingState?.status === 'queued'
          ? 'queued'
          : 'detecting';
    const stageCopy = ANALYSIS_STAGE_COPY[currentStageKey] || ANALYSIS_STAGE_COPY.detecting;
    const isMultiView = effectiveImageCount > 1;
    const stageIndex = ANALYSIS_STAGE_INDEX[currentStageKey] || 1;
    const title = loadingState?.stageLabel || stageCopy.title;
    const subtitle =
      loadingState?.stageMessage
      || (isMultiView ? stageCopy.multiPhotoMessage : stageCopy.singlePhotoMessage);

    return (
      <LoadingScreen
        badge="Photo analysis"
        message={title}
        subtitle={subtitle}
        stageLabel={`Step ${stageIndex} of ${TOTAL_ANALYSIS_STEPS}`}
        note={
          isMultiView
            ? 'We are checking multiple angles for a stronger suggestion. If confidence stays low, you can still continue manually.'
            : 'We are checking one clear photo first. If confidence stays low, you can still continue manually.'
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
