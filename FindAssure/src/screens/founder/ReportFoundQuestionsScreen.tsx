import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { LoadingScreen } from '../../components/LoadingScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { QuestionChip } from '../../components/QuestionChip';
import { GlassCard } from '../../components/GlassCard';
import { itemsApi } from '../../api/itemsApi';
import { useAppTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';

type ReportFoundQuestionsNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundQuestions'>;
type ReportFoundQuestionsRouteProp = RouteProp<RootStackParamList, 'ReportFoundQuestions'>;

const ReportFoundQuestionsScreen = () => {
  const navigation = useNavigation<ReportFoundQuestionsNavigationProp>();
  const route = useRoute<ReportFoundQuestionsRouteProp>();
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { images, preAnalysisToken, category, description } = route.params;

  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [suggestedAnswersByQuestion, setSuggestedAnswersByQuestion] = useState<Record<string, string>>({});
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQuestionsFromAI = useCallback(async () => {
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
      showToast({
        title: 'Could not prepare questions',
        message: err.response?.data?.message || err.message || 'Check your connection and try again.',
        variant: 'error',
        actionLabel: 'Retry',
        onAction: () => void fetchQuestionsFromAI(),
        dedupeKey: 'report-found-questions-fetch',
      });
    } finally {
      setLoading(false);
    }
  }, [category, description, showToast]);

  useEffect(() => {
    void fetchQuestionsFromAI();
  }, [fetchQuestionsFromAI]);

  const handleToggleQuestion = (question: string) => {
    if (selectedQuestions.includes(question)) {
      setSelectedQuestions(selectedQuestions.filter((q) => q !== question));
      return;
    }
    if (selectedQuestions.length >= 5) {
      showToast({
        title: 'Question limit reached',
        message: 'Choose any five questions before continuing.',
        variant: 'warning',
        dedupeKey: 'report-found-questions-limit',
      });
      return;
    }
    setSelectedQuestions([...selectedQuestions, question]);
  };

  const handleNext = () => {
    if (selectedQuestions.length !== 5) {
      showToast({
        title: 'Select five questions',
        message: `You have picked ${selectedQuestions.length} of 5 so far.`,
        variant: 'warning',
      });
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
      <LoadingScreen
        badge="Verification setup"
        message="Preparing ownership checks"
        subtitle="Reviewing the item details and drafting questions for you."
        stageLabel="Generating suggestions"
        note="You will choose the final five questions before publishing the report."
        illustrationVariant="pending"
      />
    );
  }

  return (
    <LinearGradient colors={theme.gradients.appBackground} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <LinearGradient colors={theme.gradients.heroAlt} style={styles.hero}>
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
            <PrimaryButton title="Retry" onPress={() => void fetchQuestionsFromAI()} variant="secondary" />
          </GlassCard>
        ) : null}

        {suggestedQuestions.map((question, index) => (
          <QuestionChip
            key={`${question}-${index}`}
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
    counterCard: {
      marginBottom: theme.spacing.lg,
    },
    counterLabel: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    counterValue: {
      ...theme.type.section,
      color: theme.colors.primaryDeep,
    },
    errorCard: {
      marginBottom: theme.spacing.lg,
    },
    errorText: {
      ...theme.type.body,
      color: theme.colors.danger,
      marginBottom: theme.spacing.md,
    },
    buttonGap: {
      marginTop: theme.spacing.md,
    },
  });

export default ReportFoundQuestionsScreen;
