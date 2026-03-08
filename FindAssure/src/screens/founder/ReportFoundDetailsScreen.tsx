import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Image } from 'expo-image';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ITEM_CATEGORIES } from '../../constants/appConstants';
import { CategoryPicker } from '../../components/CategoryPicker';
import { FormInput } from '../../components/FormInput';
import { GlassCard } from '../../components/GlassCard';
import { KeyboardAwareFormScreen } from '../../components/KeyboardAwareFormScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAppTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { RootStackParamList } from '../../types/models';
import { resolveItemCategory } from '../../utils/itemCategory';

type ReportFoundDetailsNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundDetails'>;
type ReportFoundDetailsRouteProp = RouteProp<RootStackParamList, 'ReportFoundDetails'>;

const ReportFoundDetailsScreen = () => {
  const navigation = useNavigation<ReportFoundDetailsNavigationProp>();
  const route = useRoute<ReportFoundDetailsRouteProp>();
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { images, preAnalysisToken, category: prefilledCategory, description: prefilledDescription, analysisMessage } = route.params;
  const resolvedPrefilledCategory = resolveItemCategory(prefilledCategory);

  const [category, setCategory] = useState<string>(resolvedPrefilledCategory || ITEM_CATEGORIES[0]);
  const [description, setDescription] = useState(prefilledDescription || '');

  const handleConfirm = () => {
    if (!category || !description.trim()) {
      showToast({
        title: 'Missing details',
        message: 'Please confirm the category and description.',
        variant: 'warning',
      });
      return;
    }

    navigation.navigate('ReportFoundQuestions', {
      images,
      preAnalysisToken,
      category,
      description: description.trim(),
    });
  };

  return (
    <View style={styles.container}>
      <KeyboardAwareFormScreen contentContainerStyle={styles.content}>
        <GlassCard style={styles.hero}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Report item</Text>
          </View>
          <Text style={styles.heroEyebrow}>Report details</Text>
          <Text style={styles.heroTitle}>Refine the report.</Text>
          <Text style={styles.heroBody}>Confirm the category and polish the public description before generating verification questions.</Text>
        </GlassCard>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageStrip} contentContainerStyle={styles.imageStripContent}>
          {images.map((image, index) => (
            <Image key={`${image.uri}-${index}`} source={{ uri: image.uri }} style={styles.image} contentFit="cover" />
          ))}
        </ScrollView>

        {analysisMessage ? (
          <GlassCard style={styles.cardGap}>
            <Text style={styles.sectionEyebrow}>Analysis note</Text>
            <Text style={styles.sectionBody}>{analysisMessage}</Text>
          </GlassCard>
        ) : null}

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Item details</Text>
          <Text style={styles.sectionTitle}>Prepare the public listing</Text>
          <Text style={styles.fieldLabel}>Category</Text>
          <CategoryPicker selectedValue={category} onValueChange={setCategory} />
          <FormInput
            label="Description"
            placeholder="Provide detailed description of the item..."
            value={description}
            onChangeText={setDescription}
            multiline
            hint="Manual category and description remain public. Internal detection data stays private."
            containerStyle={styles.descriptionField}
          />
        </GlassCard>

        <PrimaryButton title="Next" onPress={handleConfirm} size="lg" />
      </KeyboardAwareFormScreen>
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
    imageStrip: {
      marginBottom: theme.spacing.md,
    },
    imageStripContent: {
      gap: theme.spacing.sm,
    },
    image: {
      width: 176,
      height: 184,
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.inputMuted,
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
    sectionBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    fieldLabel: {
      ...theme.type.label,
      marginBottom: theme.spacing.sm,
    },
    descriptionField: {
      marginTop: theme.spacing.md,
    },
  });

export default ReportFoundDetailsScreen;
