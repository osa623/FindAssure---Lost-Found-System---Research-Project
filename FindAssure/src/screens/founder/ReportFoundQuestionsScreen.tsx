// ReportFoundQuestionsScreen – follow the spec
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { QuestionChip } from '../../components/QuestionChip';
import { itemsApi } from '../../api/itemsApi';
import { BASE_URL } from '../../config/api.config';

type ReportFoundQuestionsNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundQuestions'>;
type ReportFoundQuestionsRouteProp = RouteProp<RootStackParamList, 'ReportFoundQuestions'>;

const ReportFoundQuestionsScreen = () => {
  const navigation = useNavigation<ReportFoundQuestionsNavigationProp>();
  const route = useRoute<ReportFoundQuestionsRouteProp>();
  const { images, preAnalysisToken, category, description } = route.params;

  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchQuestionsFromAI();
  }, [category, description]);

  const fetchQuestionsFromAI = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('🔍 Fetching questions for:', { category, description });
      console.log('📡 API Base URL:', BASE_URL);
      
      // Call the API to generate questions using Gemini AI
      const response = await itemsApi.generateQuestions({
        category,
        description,
      });

      console.log('✅ Received questions:', response.questions);
      console.log('📝 First question:', response.questions[0]);
      
      setSuggestedQuestions(response.questions);
    } catch (err: any) {
      console.error('❌ Error generating questions:', err);
      console.error('Error details:', err.response?.data || err.message);
      setError('Failed to generate questions. Please try again.');
      
      // Show error alert with more details
      Alert.alert(
        'Error',
        `Failed to generate questions: ${err.response?.data?.message || err.message || 'Network error'}`,
        [
          {
            text: 'Retry',
            onPress: () => fetchQuestionsFromAI(),
          },
          {
            text: 'Cancel',
            style: 'cancel',
          },
        ]
      );
    } finally {
      setLoading(false);
    }
  };

  const handleToggleQuestion = (question: string) => {
    if (selectedQuestions.includes(question)) {
      setSelectedQuestions(selectedQuestions.filter(q => q !== question));
    } else {
      if (selectedQuestions.length >= 5) {
        Alert.alert('Limit Reached', 'You can only select exactly 5 questions');
        return;
      }
      setSelectedQuestions([...selectedQuestions, question]);
    }
  };

  const handleNext = () => {
    if (selectedQuestions.length !== 5) {
      Alert.alert(
        'Selection Required',
        `You must select exactly 5 questions. Currently selected: ${selectedQuestions.length}`
      );
      return;
    }

    navigation.navigate('ReportFoundAnswers', {
      images,
      preAnalysisToken,
      category,
      description,
      selectedQuestions,
    });
  };

  // Show loading state
  if (loading) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color="#1565C0" />
        <Text style={styles.loadingText}>Generating questions with AI...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Select Ownership Questions</Text>
            <Text style={styles.subtitle}>
              AI-generated questions based on your item description. Choose exactly 5 questions that the owner should answer to verify ownership.
            </Text>
            <View style={styles.counter}>
              <Text style={styles.counterText}>
                Selected: {selectedQuestions.length} / 5
              </Text>
            </View>
          </View>

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
              <PrimaryButton
                title="Retry"
                onPress={fetchQuestionsFromAI}
              />
            </View>
          )}

          <View style={styles.questionsContainer}>
            {suggestedQuestions.map((question, index) => (
              <QuestionChip
                key={index}
                question={question}
                selected={selectedQuestions.includes(question)}
                onPress={() => handleToggleQuestion(question)}
              />
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          title="Next"
          onPress={handleNext}
          disabled={selectedQuestions.length !== 5}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666666',
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 100,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 20,
    marginBottom: 16,
  },
  counter: {
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  counterText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1565C0',
  },
  errorContainer: {
    backgroundColor: '#FFEBEE',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
  },
  errorText: {
    fontSize: 14,
    color: '#C62828',
    marginBottom: 12,
    textAlign: 'center',
  },
  questionsContainer: {
    marginBottom: 20,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
});

export default ReportFoundQuestionsScreen;
