// ReportFoundAnswersScreen – follow the spec
import React, { useState } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  StyleSheet, 
  ScrollView, 
  Alert,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';

type ReportFoundAnswersNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundAnswers'>;
type ReportFoundAnswersRouteProp = RouteProp<RootStackParamList, 'ReportFoundAnswers'>;

const ReportFoundAnswersScreen = () => {
  const navigation = useNavigation<ReportFoundAnswersNavigationProp>();
  const route = useRoute<ReportFoundAnswersRouteProp>();
  const { images, preAnalysisToken, category, description, selectedQuestions } = route.params;

  const [answers, setAnswers] = useState<string[]>(
    new Array(selectedQuestions.length).fill('')
  );

  const handleAnswerChange = (index: number, text: string) => {
    const newAnswers = [...answers];
    newAnswers[index] = text;
    setAnswers(newAnswers);
  };

  const handleNext = () => {
    const allAnswered = answers.every(answer => answer.trim().length > 0);
    
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
      founderAnswers: answers.map(a => a.trim()),
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
              Type your answers to help verify the true owner. Owners will provide video answers to claim items.
            </Text>
          </View>

          <View style={styles.questionsContainer}>
            {selectedQuestions.map((question, index) => (
              <View key={index} style={styles.questionGroup}>
                <Text style={styles.questionNumber}>Question {index + 1}</Text>
                <Text style={styles.questionText}>{question}</Text>
                
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

          <View style={styles.tipsBox}>
            <Text style={styles.tipsTitle}>💡 Tips for Answering Questions:</Text>
            <Text style={styles.tipText}>• Examine the found item carefully before answering</Text>
            <Text style={styles.tipText}>• Look at all visible details, labels, and unique features</Text>
            <Text style={styles.tipText}>• Be specific and accurate in your descriptions</Text>
            <Text style={styles.tipText}>• Include colors, brands, size, or any identifying marks</Text>
            <Text style={styles.tipText}>• Your answers will help verify the true owner</Text>
            <Text style={styles.tipText}>• Only the real owner will be able to match your details</Text>
          </View>

          <PrimaryButton
            title="Next"
            onPress={handleNext}
            style={styles.nextButton}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
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
  },
  questionsContainer: {
    marginBottom: 20,
  },
  questionGroup: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  questionNumber: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A90E2',
    marginBottom: 6,
  },
  questionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 12,
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
  tipsBox: {
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  tipsTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2E7D32',
    marginBottom: 12,
  },
  tipText: {
    fontSize: 13,
    color: '#1B5E20',
    lineHeight: 20,
    marginBottom: 6,
  },
  nextButton: {
    marginBottom: 20,
  },
});

export default ReportFoundAnswersScreen;
