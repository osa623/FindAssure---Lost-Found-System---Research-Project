import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import axios from 'axios';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { itemsApi } from '../../api/itemsApi';
import { AI_BACKEND_URL } from '../../config/api.config';
import { ITEM_CATEGORIES } from '../../constants/appConstants';
import { LocationDetail } from '../../constants/locationData';
import { CategoryPicker } from '../../components/CategoryPicker';
import { FormInput } from '../../components/FormInput';
import { GlassCard } from '../../components/GlassCard';
import { KeyboardAwareFormScreen } from '../../components/KeyboardAwareFormScreen';
import { LocationPicker } from '../../components/LocationPicker';
import { OverlayLoadingState } from '../../components/OverlayLoadingState';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useAppTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { RootStackParamList, SelectedImageAsset } from '../../types/models';
import { showImageSourceOptions } from '../../utils/imageSourceOptions';

type FindLostStartNavigationProp = StackNavigationProp<RootStackParamList, 'FindLostStart'>;

const CONFIDENCE_OPTIONS = [
  { value: 1, emoji: '😊', title: 'Pretty Sure', tone: '#1E9E64' },
  { value: 2, emoji: '🙂', title: 'Sure', tone: '#2F57E5' },
  { value: 3, emoji: '🤔', title: 'Not Sure', tone: '#D9822B' },
  { value: 4, emoji: '😕', title: "Don't Remember", tone: '#D34A5C' },
];

const FindLostStartScreen = () => {
  const navigation = useNavigation<FindLostStartNavigationProp>();
  const { user } = useAuth();
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);

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
          const fixes = res.data.corrections?.length ? res.data.corrections.join(', ') : 'Grammar auto-corrected';
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

  const handleDescriptionChange = useCallback(
    (text: string) => {
      setDescription(text);
      triggerGrammarCheck(text);
    },
    [triggerGrammarCheck]
  );

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

  const handleCaptureOwnerImage = async () => {
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
      showToast({
        title: 'Missing details',
        message: 'Please complete the category, description, and location.',
        variant: 'warning',
      });
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
      showToast({
        title: 'Search failed',
        message: error.message || 'Could not search for items. Please try again.',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAwareFormScreen contentContainerStyle={styles.content}>
        <GlassCard style={styles.hero}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Owner flow</Text>
          </View>
          <Text style={styles.heroEyebrow}>Search</Text>
          <Text style={styles.heroTitle}>Describe what you lost.</Text>
          <Text style={styles.heroBody}>A good search combines item context, location confidence, and an optional reference image.</Text>
        </GlassCard>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Search context</Text>
          <Text style={styles.sectionTitle}>Give the system enough detail to match well</Text>
          <Text style={styles.fieldLabel}>Category</Text>
          <CategoryPicker selectedValue={category} onValueChange={setCategory} />
          <FormInput
            label="Description"
            placeholder="Describe your lost item in detail..."
            value={description}
            onChangeText={handleDescriptionChange}
            multiline
            hint={grammarNote || 'Include color, brand, materials, and identifying details.'}
            containerStyle={styles.fieldGap}
          />
          {grammarChecking ? (
            <View style={styles.grammarRow}>
              <ActivityIndicator size="small" color={theme.colors.accent} />
              <Text style={styles.grammarText}>Checking grammar…</Text>
            </View>
          ) : null}
        </GlassCard>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Place memory</Text>
          <Text style={styles.sectionTitle}>Where do you think you lost it?</Text>
          <LocationPicker selectedValue={location} onValueChange={setLocation} allowDoNotRemember userType="owner" error={!location ? undefined : ''} />
        </GlassCard>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Confidence</Text>
          <Text style={styles.sectionTitle}>How certain are you about that location?</Text>
          <View style={styles.confidenceGrid}>
            {CONFIDENCE_OPTIONS.map((option) => {
              const active = confidenceStage === option.value;
              return (
                <Pressable
                  key={option.value}
                  style={[styles.confidenceCard, active && { borderColor: option.tone, backgroundColor: `${option.tone}18` }]}
                  onPress={() => setConfidenceStage(option.value)}
                >
                  <Text style={styles.confidenceEmoji}>{option.emoji}</Text>
                  <Text numberOfLines={2} style={[styles.confidenceTitle, active && { color: option.tone }]}>
                    {option.title}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </GlassCard>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Optional image</Text>
          <Text style={styles.sectionTitle}>Add a photo if you have one</Text>
          {ownerImage ? (
            <View style={styles.ownerImageWrap}>
              <Image source={{ uri: ownerImage.uri }} style={styles.ownerImagePreview} contentFit="cover" />
              <Pressable
                onPress={() => setOwnerImage(null)}
                style={styles.removeWrap}
                accessibilityRole="button"
                accessibilityLabel="Remove selected photo"
              >
                <Ionicons name="close" size={14} color={theme.colors.inverse} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={styles.uploadCard}
              onPress={() =>
                showImageSourceOptions({
                  title: 'Add Reference Photo',
                  onTakePhoto: handleCaptureOwnerImage,
                  onChooseFromLibrary: handleSelectOwnerImage,
                })
              }
            >
              <Text style={styles.uploadIcon}>⌁</Text>
              <Text style={styles.uploadTitle}>Add reference photo</Text>
              <Text style={styles.uploadBody}>Tap to take a photo or choose one from your library.</Text>
            </Pressable>
          )}
        </GlassCard>

        <PrimaryButton title="Search Found Items" onPress={handleSearch} loading={loading} size="lg" />
      </KeyboardAwareFormScreen>

      <OverlayLoadingState
        visible={loading}
        title="Searching reported items"
        message="Comparing your details against available reports."
      />
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    content: {
      paddingTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
    },
    hero: {
      padding: theme.spacing.lg,
      marginBottom: theme.spacing.md,
    },
    heroBadge: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.accentSoft,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      marginBottom: theme.spacing.sm,
    },
    heroBadgeText: {
      ...theme.type.caption,
      color: theme.colors.accent,
      fontWeight: '700',
    },
    heroEyebrow: {
      ...theme.type.label,
      color: theme.colors.accent,
      marginBottom: theme.spacing.xs,
    },
    heroTitle: {
      ...theme.type.title,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.sm,
    },
    heroBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    cardGap: {
      marginBottom: theme.spacing.md,
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
    fieldLabel: {
      ...theme.type.label,
      marginBottom: theme.spacing.sm,
    },
    fieldGap: {
      marginTop: theme.spacing.md,
    },
    grammarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    grammarText: {
      ...theme.type.caption,
      color: theme.colors.accent,
    },
    confidenceGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    confidenceCard: {
      width: '47.5%',
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.input,
      minHeight: 84,
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confidenceEmoji: {
      fontSize: 24,
      marginBottom: theme.spacing.xs,
    },
    confidenceTitle: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      textAlign: 'center',
      fontSize: 13,
      lineHeight: 17,
    },
    uploadCard: {
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      backgroundColor: theme.colors.input,
      padding: theme.spacing.md,
      alignItems: 'center',
    },
    uploadIcon: {
      ...theme.type.section,
      color: theme.colors.accent,
      marginBottom: theme.spacing.xs,
    },
    uploadTitle: {
      ...theme.type.cardTitle,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.xs,
    },
    uploadBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      textAlign: 'center',
    },
    ownerImageWrap: {
      position: 'relative',
    },
    ownerImagePreview: {
      width: '100%',
      height: 196,
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.inputMuted,
    },
    removeWrap: {
      position: 'absolute',
      top: theme.spacing.sm,
      right: theme.spacing.sm,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: 'rgba(15, 23, 42, 0.72)',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

export default FindLostStartScreen;
