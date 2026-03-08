import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { FormInput } from '../../components/FormInput';
import { GlassCard } from '../../components/GlassCard';
import { gradients, palette, radius, spacing, type } from '../../theme/designSystem';

type ReportFoundAnswersNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundAnswers'>;
type ReportFoundAnswersRouteProp = RouteProp<RootStackParamList, 'ReportFoundAnswers'>;

const ReportFoundAnswersScreen = () => {
  const navigation = useNavigation<ReportFoundAnswersNavigationProp>();
  const route = useRoute<ReportFoundAnswersRouteProp>();
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
    const next = [...answers];
    next[index] = text;
    setAnswers(next);
  };

  const handleNext = () => {
    const allAnswered = answers.every((answer) => answer.trim().length > 0);
    if (!allAnswered) {
      Alert.alert('Incomplete', 'Please answer all questions');
      return;
    }

    navigation.navigate('ReportFoundLocation', {
      images,
      preAnalysisToken,
      category,
      description,
      selectedQuestions,
      founderAnswers: answers.map((a) => a.trim()),
    });
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Answer the Questions</Text>
            <Text style={styles.subtitle}>
              AI suggested answers are prefilled. Review and edit each answer before submitting.
            </Text>
          </View>

          <View style={styles.questionsContainer}>
            {selectedQuestions.map((question, index) => (
              <View key={index} style={styles.questionGroup}>
                <Text style={styles.questionNumber}>Question {index + 1}</Text>
                <Text style={styles.questionText}>{question}</Text>
                {suggestedAnswersByQuestion?.[question] ? (
                  <Text style={styles.suggestionText}>
                    Suggested: {suggestedAnswersByQuestion[question]}
                  </Text>
                ) : null}
                
                {/* Text Input Only for Founders */}
                <TextInput
                  style={styles.answerInput}
                  placeholder="Type your answer here..."
                  value={answers[index]}
                  onChangeText={(text) => handleAnswerChange(index, text)}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>
            ))}
          </View>

          <GlassCard style={styles.cardGap}>
            <Text style={styles.tipTitle}>Answering tips</Text>
            <Text style={styles.tipText}>Examine the item closely and include details like color, brand, materials, size, or unique marks.</Text>
            <Text style={styles.tipText}>Keep answers truthful and specific so only the real owner can match them later.</Text>
          </GlassCard>

          <PrimaryButton title="Next" onPress={handleNext} size="lg" />
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
  cardGap: {
    marginBottom: spacing.lg,
  },
  suggestionText: {
    fontSize: 12,
    color: '#2E7D32',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  answerInput: {
    borderWidth: 1,
    borderColor: '#DDDDDD',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#FAFAFA',
    minHeight: 100,
  },
  questionText: {
    ...type.cardTitle,
    marginBottom: spacing.lg,
  },
  tipTitle: {
    ...type.section,
    marginBottom: spacing.sm,
  },
  tipText: {
    ...type.body,
    marginBottom: spacing.sm,
  },
});

export default ReportFoundAnswersScreen;
