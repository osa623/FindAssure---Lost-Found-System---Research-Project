import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  Alert,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { CategoryPicker } from '../../components/CategoryPicker';
import { FormInput } from '../../components/FormInput';
import { GlassCard } from '../../components/GlassCard';
import { ITEM_CATEGORIES } from '../../constants/appConstants';
import { gradients, palette, radius, spacing, type } from '../../theme/designSystem';

type ReportFoundDetailsNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundDetails'>;
type ReportFoundDetailsRouteProp = RouteProp<RootStackParamList, 'ReportFoundDetails'>;

const ReportFoundDetailsScreen = () => {
  const navigation = useNavigation<ReportFoundDetailsNavigationProp>();
  const route = useRoute<ReportFoundDetailsRouteProp>();
  const { images, preAnalysisToken, category: prefilledCategory, description: prefilledDescription, analysisMessage } = route.params;

  const [category, setCategory] = useState<string>(prefilledCategory || ITEM_CATEGORIES[0]);
  const [description, setDescription] = useState(prefilledDescription || '');

  const handleConfirm = () => {
    if (!category || !description.trim()) {
      Alert.alert('Required Fields', 'Please fill in all fields');
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
    <LinearGradient colors={gradients.appBackground} style={styles.container}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content}>
          <GlassCard style={styles.hero}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Founder flow</Text>
            </View>
            <Text style={styles.heroEyebrow}>Founder flow</Text>
            <Text style={styles.heroTitle}>Refine the report.</Text>
            <Text style={styles.heroBody}>Confirm the category and polish the public description before generating verification questions.</Text>
          </GlassCard>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageStrip} contentContainerStyle={styles.imageStripContent}>
            {images.map((image, index) => (
              <Image
                key={`${image.uri}-${index}`}
                source={{ uri: image.uri }}
                style={styles.image}
                contentFit="cover"
              />
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
        </ScrollView>
      </KeyboardAvoidingView>
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
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: palette.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    marginBottom: spacing.sm,
  },
  heroBadgeText: {
    ...type.caption,
    color: palette.primaryDeep,
    fontWeight: '700',
  },
  heroEyebrow: {
    ...type.label,
    color: palette.primaryDeep,
    marginBottom: spacing.xs,
  },
  heroTitle: {
    ...type.title,
    color: palette.ink,
    marginBottom: spacing.sm,
  },
  heroBody: {
    ...type.body,
    color: palette.inkSoft,
  },
  imageStrip: {
    marginBottom: spacing.lg,
  },
  imageStripContent: {
    gap: spacing.sm,
  },
  image: {
    width: 188,
    height: 202,
    borderRadius: radius.lg,
    backgroundColor: palette.shell,
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
  sectionBody: {
    ...type.body,
  },
  fieldLabel: {
    ...type.label,
    marginBottom: spacing.sm,
  },
  descriptionField: {
    marginTop: spacing.md,
  },
});

export default ReportFoundDetailsScreen;
