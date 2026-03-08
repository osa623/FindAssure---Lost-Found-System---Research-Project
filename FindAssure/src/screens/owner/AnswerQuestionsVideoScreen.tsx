// AnswerQuestionsVideoScreen – Video recording with 5-second limit, preview, and retake
import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  Alert,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Modal
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, OwnerAnswerInput } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { itemsApi } from '../../api/itemsApi';
import { VideoRecorder } from '../../components/VideoRecorder';

type AnswerQuestionsVideoNavigationProp = StackNavigationProp<RootStackParamList, 'AnswerQuestionsVideo'>;
type AnswerQuestionsVideoRouteProp = RouteProp<RootStackParamList, 'AnswerQuestionsVideo'>;

const AnswerQuestionsVideoScreen = () => {
  const navigation = useNavigation<AnswerQuestionsVideoNavigationProp>();
  const route = useRoute<AnswerQuestionsVideoRouteProp>();
  const { foundItem } = route.params;

  // Store video URIs for each question
  const [videoAnswers, setVideoAnswers] = useState<(string | null)[]>(
    new Array(foundItem.questions.length).fill(null)
  );
  // Track which question is being recorded
  const [recordingQuestionIndex, setRecordingQuestionIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('Uploading your answers...');
  const progressAnim = useState(new Animated.Value(0))[0];
  const pulseAnim = useState(new Animated.Value(1))[0];

  // Animated loading messages
  const loadingMessages = [
    'Uploading your answers...',
    'Processing video answers...',
    'Running AI analysis...',
    'Comparing with found item details...',
    'Calculating similarity scores...',
    'Almost done, finalizing results...'
  ];

  useEffect(() => {
    if (loading) {
      // Start pulse animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Simulate progress updates
      let progress = 0;
      let messageIndex = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 15 + 5; // Random increment between 5-20%
        if (progress > 95) progress = 95; // Cap at 95% until actually done
        
        setLoadingProgress(progress);
        
        // Update message based on progress
        const newMessageIndex = Math.floor((progress / 100) * loadingMessages.length);
        if (newMessageIndex !== messageIndex && newMessageIndex < loadingMessages.length) {
          messageIndex = newMessageIndex;
          setLoadingMessage(loadingMessages[newMessageIndex]);
        }
        
        Animated.timing(progressAnim, {
          toValue: progress,
          duration: 500,
          useNativeDriver: false,
        }).start();
      }, 1500);

      return () => clearInterval(interval);
    }
  }, [loading]);

  const handleRecordVideo = (index: number) => {
    setRecordingQuestionIndex(index);
  };

  const handleVideoRecorded = (videoUri: string) => {
    if (recordingQuestionIndex !== null) {
      const newVideoAnswers = [...videoAnswers];
      newVideoAnswers[recordingQuestionIndex] = videoUri;
      setVideoAnswers(newVideoAnswers);
      setRecordingQuestionIndex(null);
    }
  };

  const handleCancelRecording = () => {
    setRecordingQuestionIndex(null);
  };

  const handleRemoveVideo = (index: number) => {
    const newVideoAnswers = [...videoAnswers];
    newVideoAnswers[index] = null;
    setVideoAnswers(newVideoAnswers);
  };

  const handleSubmit = async () => {
    // Check if all questions have video answers
    const allAnswered = videoAnswers.every(video => video !== null);

    if (!allAnswered) {
      Alert.alert('Incomplete', 'Please record video answers for all questions');
      return;
    }

    try {
      setLoading(true);

      // Map question index to word format (0 -> one, 1 -> two, etc.)
      const numberWords = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

      // Build unified owner answers array with questionId, answer, videoKey, and videoUri
      const ownerAnswers: OwnerAnswerInput[] = videoAnswers.map((videoUri, index) => {
        const videoKey = `owner_answer_${numberWords[index] || index + 1}`; // Match Python backend format

        return {
          questionId: index,
          answer: '[Video Answer]',
          videoKey: videoKey,
          videoUri: videoUri!,
        };
      });

      console.log('📤 Submitting verification:', {
        foundItemId: foundItem._id,
        answersCount: ownerAnswers.length,
        videoCount: ownerAnswers.filter(a => a.videoUri).length,
      });

      // Submit verification request
      const response = await itemsApi.submitVerification({
        foundItemId: foundItem._id,
        ownerAnswers,
      });

      console.log('✅ Verification response:', response);

      // Set progress to 100% before navigating
      setLoadingProgress(100);
      setLoadingMessage('Success! Redirecting...');
      
      // Small delay to show completion
      await new Promise(resolve => setTimeout(resolve, 800));

      // Navigate to verification result screen with the verification ID
      navigation.navigate('VerificationResult', { 
        verificationId: response._id 
      });
    } catch (error: any) {
      console.error('❌ Submission error:', error);
      Alert.alert(
        'Submission Failed',
        error.message || 'Could not submit verification. Please try again.'
      );
    } finally {
      setLoading(false);
    }
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
              Record video answers (max 5 seconds each) to verify your ownership
            </Text>
          </View>

          <View style={styles.questionsContainer}>
            {foundItem.questions.map((question, index) => (
              <View key={index} style={styles.questionCard}>
                <Text style={styles.questionNumber}>Question {index + 1}</Text>
                <Text style={styles.questionText}>{question}</Text>

                {/* Video Answer Section */}
                {videoAnswers[index] ? (
                  <View style={styles.videoAnswerContainer}>
                    <View style={styles.videoRecordedBadge}>
                      <Text style={styles.videoRecordedIcon}>✓</Text>
                      <Text style={styles.videoRecordedText}>Video Answer Recorded</Text>
                    </View>
                    <View style={styles.videoActions}>
                      <TouchableOpacity 
                        style={styles.viewVideoButton}
                        onPress={() => handleRecordVideo(index)}
                      >
                        <Text style={styles.viewVideoText}>👁 View/Retake</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={styles.removeVideoButton}
                        onPress={() => handleRemoveVideo(index)}
                      >
                        <Text style={styles.removeVideoText}>🗑 Remove</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity 
                    style={styles.recordButton}
                    onPress={() => handleRecordVideo(index)}
                  >
                    <Text style={styles.recordIcon}>🎥</Text>
                    <Text style={styles.recordText}>Record Video Answer (Max 5s)</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              📝 Video Answer Tips:
            </Text>
            <Text style={styles.infoText}>• Record video answers (max 5 seconds each)</Text>
            <Text style={styles.infoText}>• Speak clearly and look at the camera</Text>
            <Text style={styles.infoText}>• Be specific and accurate</Text>
            <Text style={styles.infoText}>• Provide details only the true owner would know</Text>
            <Text style={styles.infoText}>• You can preview and retake videos before submitting</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          title="Submit Verification"
          onPress={handleSubmit}
          loading={loading}
        />
      </View>

      {/* Video Recorder Modal */}
      {recordingQuestionIndex !== null && (
        <VideoRecorder
          questionNumber={recordingQuestionIndex + 1}
          onVideoRecorded={handleVideoRecorded}
          onCancel={handleCancelRecording}
        />
      )}

      {/* Enhanced Loading Modal */}
      <Modal
        visible={loading}
        transparent
        animationType="fade"
      >
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContainer}>
            {/* Animated Icon */}
            <Animated.View style={[styles.loadingIconContainer, { transform: [{ scale: pulseAnim }] }]}>
              <Text style={styles.loadingIcon}>🔍</Text>
            </Animated.View>

            <Text style={styles.loadingTitle}>Processing Verification</Text>
            <Text style={styles.loadingSubtitle}>{loadingMessage}</Text>

            {/* Progress Bar */}
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBarBackground}>
                <Animated.View 
                  style={[
                    styles.progressBarFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 100],
                        outputRange: ['0%', '100%']
                      })
                    }
                  ]} 
                />
              </View>
              <Text style={styles.progressText}>{Math.round(loadingProgress)}%</Text>
            </View>

            {/* Activity Indicator */}
            <ActivityIndicator size="large" color="#2563EB" style={styles.spinner} />

            {/* Fun Facts */}
            <View style={styles.tipsContainer}>
              <Text style={styles.tipsTitle}>💡 Did you know?</Text>
              <Text style={styles.tipsText}>
                Our AI analyzes multiple factors including voice patterns, answer details, 
                and confidence levels to accurately verify ownership.
              </Text>
            </View>

            <Text style={styles.pleaseWaitText}>Please don&apos;t close the app...</Text>
          </View>
        </View>
      </Modal>
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
  },
  questionsContainer: {
    marginBottom: 20,
  },
  questionCard: {
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
  recordButton: {
    backgroundColor: '#4A90E2',
    borderRadius: 8,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  recordIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  recordText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  videoAnswerContainer: {
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    padding: 16,
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  videoRecordedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  videoRecordedIcon: {
    fontSize: 18,
    color: '#4CAF50',
    marginRight: 8,
  },
  videoRecordedText: {
    fontSize: 15,
    color: '#2E7D32',
    fontWeight: '600',
  },
  videoActions: {
    flexDirection: 'row',
    gap: 8,
  },
  viewVideoButton: {
    flex: 1,
    backgroundColor: '#4A90E2',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  viewVideoText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  removeVideoButton: {
    flex: 1,
    backgroundColor: '#EF4444',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  removeVideoText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  orText: {
    textAlign: 'center',
    fontSize: 12,
    color: '#999999',
    marginVertical: 8,
    fontWeight: '600',
  },
  answerInput: {
    borderWidth: 1,
    borderColor: '#DDDDDD',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#FAFAFA',
    minHeight: 80,
  },
  infoBox: {
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  infoText: {
    fontSize: 13,
    color: '#666666',
    marginBottom: 4,
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
  // Loading Modal Styles
  loadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 30,
    width: '90%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  loadingIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  loadingIcon: {
    fontSize: 40,
  },
  loadingTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 8,
    textAlign: 'center',
  },
  loadingSubtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginBottom: 24,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  progressBarContainer: {
    width: '100%',
    marginBottom: 20,
  },
  progressBarBackground: {
    width: '100%',
    height: 10,
    backgroundColor: '#E5E7EB',
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#2563EB',
    borderRadius: 5,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
    textAlign: 'center',
  },
  spinner: {
    marginVertical: 16,
  },
  tipsContainer: {
    backgroundColor: '#FFF9E6',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    width: '100%',
    borderLeftWidth: 3,
    borderLeftColor: '#FFC107',
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 8,
  },
  tipsText: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 20,
  },
  pleaseWaitText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontStyle: 'italic',
    marginTop: 16,
    textAlign: 'center',
  },});

export default AnswerQuestionsVideoScreen;
