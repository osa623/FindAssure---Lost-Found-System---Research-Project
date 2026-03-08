import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { GlassCard } from '../../components/GlassCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAppTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { RootStackParamList } from '../../types/models';

type ReportFoundAnswersNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundAnswers'>;
type ReportFoundAnswersRouteProp = RouteProp<RootStackParamList, 'ReportFoundAnswers'>;

const ReportFoundAnswersScreen = () => {
  const navigation = useNavigation<ReportFoundAnswersNavigationProp>();
  const route = useRoute<ReportFoundAnswersRouteProp>();
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const {
    images,
    preAnalysisToken,
    category,
    description,
    selectedQuestions,
    suggestedAnswersByQuestion,
  } = route.params;

  const [answers, setAnswers] = useState<string[]>(
    selectedQuestions.map((question) => suggestedAnswersByQuestion?.[question] || '')
  );

  const handleAnswerChange = (index: number, text: string) => {
    const newAnswers = [...answers];
    newAnswers[index] = text;
    setAnswers(newAnswers);
  };

  const handleNext = () => {
    const allAnswered = answers.every((answer) => answer.trim().length > 0);

    if (!allAnswered) {
      showToast({
        title: 'Incomplete answers',
        message: 'Please answer every verification question before continuing.',
        variant: 'warning',
      });
      return;
    }

    navigation.navigate('ReportFoundLocation', {
      images,
      preAnalysisToken,
      category,
      description,
      selectedQuestions,
      founderAnswers: answers.map((answer) => answer.trim()),
    });
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GlassCard style={styles.hero}>
          <Text style={styles.heroEyebrow}>Founder answers</Text>
          <Text style={styles.title}>Answer the Questions</Text>
          <Text style={styles.subtitle}>
            AI suggestions are prefilled when available. Review them carefully and replace anything that is too vague.
          </Text>
        </GlassCard>

        <View style={styles.questionsContainer}>
          {selectedQuestions.map((question, index) => (
            <GlassCard key={question} style={styles.questionGroup}>
              <Text style={styles.questionNumber}>Question {index + 1}</Text>
              <Text style={styles.questionText}>{question}</Text>
              {suggestedAnswersByQuestion?.[question] ? (
                <View style={styles.suggestionChip}>
                  <Text style={styles.suggestionText}>Suggested answer available</Text>
                </View>
              ) : null}

              <TextInput
                style={styles.answerInput}
                placeholder="Type your answer here..."
                placeholderTextColor={theme.colors.placeholder}
                value={answers[index]}
                onChangeText={(text) => handleAnswerChange(index, text)}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </GlassCard>
          ))}
        </View>

        <GlassCard style={styles.tipsBox}>
          <Text style={styles.tipsTitle}>Answering tips</Text>
          <Text style={styles.tipText}>Examine the found item carefully before answering.</Text>
          <Text style={styles.tipText}>Look at visible labels, colors, wear marks, and unique details.</Text>
          <Text style={styles.tipText}>Be specific and accurate instead of generic.</Text>
          <Text style={styles.tipText}>These answers are what the real owner will need to match later.</Text>
        </GlassCard>

        <PrimaryButton title="Next" onPress={handleNext} style={styles.nextButton} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollView: {
      flex: 1,
    },
    content: {
      padding: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
    },
    hero: {
      marginBottom: theme.spacing.lg,
    },
    heroEyebrow: {
      ...theme.type.label,
      color: theme.colors.accent,
      marginBottom: theme.spacing.xs,
    },
    title: {
      ...theme.type.title,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.sm,
    },
    subtitle: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      lineHeight: 20,
    },
    questionsContainer: {
      marginBottom: theme.spacing.lg,
    },
    questionGroup: {
      marginBottom: theme.spacing.md,
    },
    questionNumber: {
      ...theme.type.caption,
      color: theme.colors.accent,
      fontWeight: '700',
      marginBottom: theme.spacing.xs,
    },
    questionText: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.sm,
    },
    suggestionChip: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.successSoft,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      marginBottom: theme.spacing.sm,
    },
    suggestionText: {
      ...theme.type.caption,
      color: theme.colors.success,
      fontWeight: '700',
    },
    answerInput: {
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      fontSize: 14,
      lineHeight: 20,
      color: theme.colors.textStrong,
      backgroundColor: theme.colors.input,
      minHeight: 112,
    },
    tipsBox: {
      marginBottom: theme.spacing.lg,
      borderColor: theme.colors.successSoft,
    },
    tipsTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.md,
    },
    tipText: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      lineHeight: 20,
      marginBottom: theme.spacing.sm,
    },
    nextButton: {
      marginBottom: theme.spacing.md,
    },
  });

export default ReportFoundAnswersScreen;
