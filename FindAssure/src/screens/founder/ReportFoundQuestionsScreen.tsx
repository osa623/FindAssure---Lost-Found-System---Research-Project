import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { QuestionChip } from '../../components/QuestionChip';
import { GlassCard } from '../../components/GlassCard';
import { itemsApi } from '../../api/itemsApi';
import { gradients, palette, radius, spacing, type } from '../../theme/designSystem';

type ReportFoundQuestionsNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundQuestions'>;
type ReportFoundQuestionsRouteProp = RouteProp<RootStackParamList, 'ReportFoundQuestions'>;

const ReportFoundQuestionsScreen = () => {
  const navigation = useNavigation<ReportFoundQuestionsNavigationProp>();
  const route = useRoute<ReportFoundQuestionsRouteProp>();
  const { images, preAnalysisToken, category, description } = route.params;

  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [suggestedAnswersByQuestion, setSuggestedAnswersByQuestion] = useState<Record<string, string>>({});
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchQuestionsFromAI();
  }, [category, description]);

  const fetchQuestionsFromAI = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await itemsApi.generateQuestions({ category, description });
      setSuggestedQuestions(response.questions);

      const answerMap: Record<string, string> = {};
      response.questions.forEach((question, index) => {
        const suggested = response.suggestedFounderAnswers?.[index];
        if (suggested && suggested.trim().length > 0) {
          answerMap[question] = suggested.trim();
        }
      });
      setSuggestedAnswersByQuestion(answerMap);
    } catch (err: any) {
      setError('Failed to generate questions. Please try again.');
      Alert.alert('Error', `Failed to generate questions: ${err.response?.data?.message || err.message || 'Network error'}`, [
        { text: 'Retry', onPress: () => fetchQuestionsFromAI() },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleQuestion = (question: string) => {
    if (selectedQuestions.includes(question)) {
      setSelectedQuestions(selectedQuestions.filter((q) => q !== question));
      return;
    }
    if (selectedQuestions.length >= 5) {
      Alert.alert('Limit Reached', 'You can only select exactly 5 questions');
      return;
    }
    setSelectedQuestions([...selectedQuestions, question]);
  };

  const handleNext = () => {
    if (selectedQuestions.length !== 5) {
      Alert.alert('Selection Required', `You must select exactly 5 questions. Currently selected: ${selectedQuestions.length}`);
      return;
    }
    navigation.navigate('ReportFoundAnswers', {
      images,
      preAnalysisToken,
      category,
      description,
      selectedQuestions,
      suggestedAnswersByQuestion,
    });
  };

  if (loading) {
    return (
      <LinearGradient colors={gradients.appBackground} style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={palette.primaryDeep} />
        <Text style={styles.loadingText}>Generating questions with AI...</Text>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={gradients.appBackground} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <LinearGradient colors={gradients.heroAlt} style={styles.hero}>
          <Text style={styles.heroEyebrow}>Verification setup</Text>
          <Text style={styles.heroTitle}>Choose five ownership checks.</Text>
          <Text style={styles.heroBody}>Select the questions that only the real owner should be able to answer accurately.</Text>
        </LinearGradient>

        <GlassCard style={styles.counterCard}>
          <Text style={styles.counterLabel}>Selected</Text>
          <Text style={styles.counterValue}>{selectedQuestions.length} / 5</Text>
        </GlassCard>

        {error ? (
          <GlassCard style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <PrimaryButton title="Retry" onPress={fetchQuestionsFromAI} variant="secondary" />
          </GlassCard>
        ) : null}

        {suggestedQuestions.map((question, index) => (
          <QuestionChip
            key={index}
            question={question}
            selected={selectedQuestions.includes(question)}
            onPress={() => handleToggleQuestion(question)}
          />
        ))}

        <PrimaryButton title="Next" onPress={handleNext} disabled={selectedQuestions.length !== 5} size="lg" style={styles.buttonGap} />
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
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...type.bodyStrong,
    marginTop: spacing.lg,
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
  counterCard: {
    marginBottom: spacing.lg,
  },
  counterLabel: {
    ...type.label,
    marginBottom: spacing.xs,
  },
  counterValue: {
    ...type.section,
    color: palette.primaryDeep,
  },
  errorCard: {
    marginBottom: spacing.lg,
  },
  errorText: {
    ...type.body,
    color: palette.danger,
    marginBottom: spacing.md,
  },
  buttonGap: {
    marginTop: spacing.md,
  },
});

export default ReportFoundQuestionsScreen;
