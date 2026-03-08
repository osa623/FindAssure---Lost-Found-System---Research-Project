import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { itemsApi } from '../../api/itemsApi';
import { GlassCard } from '../../components/GlassCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { VideoRecorder } from '../../components/VideoRecorder';
import { useAppTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { OwnerAnswerInput, RootStackParamList } from '../../types/models';

type AnswerQuestionsVideoNavigationProp = StackNavigationProp<RootStackParamList, 'AnswerQuestionsVideo'>;
type AnswerQuestionsVideoRouteProp = RouteProp<RootStackParamList, 'AnswerQuestionsVideo'>;

const LOADING_MESSAGES = [
  'Uploading your answers...',
  'Processing video answers...',
  'Running AI analysis...',
  'Comparing with found item details...',
  'Calculating similarity scores...',
  'Almost done, finalizing results...',
];

const AnswerQuestionsVideoScreen = () => {
  const navigation = useNavigation<AnswerQuestionsVideoNavigationProp>();
  const route = useRoute<AnswerQuestionsVideoRouteProp>();
  const { foundItem } = route.params;
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [videoAnswers, setVideoAnswers] = useState<(string | null)[]>(
    new Array(foundItem.questions.length).fill(null)
  );
  const [recordingQuestionIndex, setRecordingQuestionIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('Uploading your answers...');
  const progressAnim = useState(new Animated.Value(0))[0];
  const pulseAnim = useState(new Animated.Value(1))[0];

  useEffect(() => {
    if (!loading) {
      progressAnim.setValue(0);
      pulseAnim.setValue(1);
      return;
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.12,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    let progress = 0;
    let messageIndex = 0;

    const interval = setInterval(() => {
      progress += Math.random() * 15 + 5;
      if (progress > 95) progress = 95;

      setLoadingProgress(progress);

      const newMessageIndex = Math.floor((progress / 100) * LOADING_MESSAGES.length);
      if (newMessageIndex !== messageIndex && newMessageIndex < LOADING_MESSAGES.length) {
        messageIndex = newMessageIndex;
        setLoadingMessage(LOADING_MESSAGES[newMessageIndex]);
      }

      Animated.timing(progressAnim, {
        toValue: progress,
        duration: 500,
        useNativeDriver: false,
      }).start();
    }, 1500);

    return () => {
      clearInterval(interval);
      pulseLoop.stop();
    };
  }, [loading, progressAnim, pulseAnim]);

  const handleVideoRecorded = (videoUri: string) => {
    if (recordingQuestionIndex === null) {
      return;
    }

    const newVideoAnswers = [...videoAnswers];
    newVideoAnswers[recordingQuestionIndex] = videoUri;
    setVideoAnswers(newVideoAnswers);
    setRecordingQuestionIndex(null);
  };

  const handleRemoveVideo = (index: number) => {
    const newVideoAnswers = [...videoAnswers];
    newVideoAnswers[index] = null;
    setVideoAnswers(newVideoAnswers);
  };

  const handleSubmit = async () => {
    const allAnswered = videoAnswers.every((video) => video !== null);

    if (!allAnswered) {
      showToast({
        title: 'Incomplete verification',
        message: 'Please record a video answer for every question.',
        variant: 'warning',
      });
      return;
    }

    try {
      setLoading(true);

      const numberWords = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
      const ownerAnswers: OwnerAnswerInput[] = videoAnswers.map((videoUri, index) => {
        const videoKey = `owner_answer_${numberWords[index] || index + 1}`;

        return {
          questionId: index,
          answer: '[Video Answer]',
          videoKey,
          videoUri: videoUri!,
        };
      });

      const response = await itemsApi.submitVerification({
        foundItemId: foundItem._id,
        ownerAnswers,
      });

      setLoadingProgress(100);
      setLoadingMessage('Success! Redirecting...');

      await new Promise((resolve) => setTimeout(resolve, 800));
      navigation.navigate('VerificationResult', {
        verificationId: response._id,
      });
    } catch (error: any) {
      showToast({
        title: 'Submission failed',
        message: error.message || 'Could not submit verification. Please try again.',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GlassCard style={styles.headerCard}>
          <Text style={styles.title}>Answer the Questions</Text>
          <Text style={styles.subtitle}>Record video answers up to 5 seconds long to verify your ownership.</Text>
        </GlassCard>

        <View style={styles.questionsContainer}>
          {foundItem.questions.map((question, index) => (
            <GlassCard key={`${question}-${index}`} style={styles.questionCard}>
              <Text style={styles.questionNumber}>Question {index + 1}</Text>
              <Text style={styles.questionText}>{question}</Text>

              {videoAnswers[index] ? (
                <View style={styles.videoAnswerContainer}>
                  <View style={styles.videoRecordedBadge}>
                    <Text style={styles.videoRecordedIcon}>✓</Text>
                    <Text style={styles.videoRecordedText}>Video answer recorded</Text>
                  </View>
                  <View style={styles.videoActions}>
                    <TouchableOpacity style={styles.viewVideoButton} onPress={() => setRecordingQuestionIndex(index)}>
                      <Text style={styles.viewVideoText}>View / Retake</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.removeVideoButton} onPress={() => handleRemoveVideo(index)}>
                      <Text style={styles.removeVideoText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity style={styles.recordButton} onPress={() => setRecordingQuestionIndex(index)}>
                  <Text style={styles.recordIcon}>🎥</Text>
                  <Text style={styles.recordText}>Record Video Answer</Text>
                </TouchableOpacity>
              )}
            </GlassCard>
          ))}
        </View>

        <GlassCard style={styles.infoBox}>
          <Text style={styles.infoTitle}>Video answer tips</Text>
          <Text style={styles.infoText}>Record one short clip per question.</Text>
          <Text style={styles.infoText}>Speak clearly and look at the camera.</Text>
          <Text style={styles.infoText}>Give specific details only the true owner would know.</Text>
          <Text style={styles.infoText}>You can preview, remove, and retake clips before submitting.</Text>
        </GlassCard>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton title="Submit Verification" onPress={handleSubmit} loading={loading} />
      </View>

      {recordingQuestionIndex !== null ? (
        <VideoRecorder
          questionNumber={recordingQuestionIndex + 1}
          onVideoRecorded={handleVideoRecorded}
          onCancel={() => setRecordingQuestionIndex(null)}
        />
      ) : null}

      <Modal visible={loading} transparent animationType="fade">
        <View style={styles.loadingOverlay}>
          <GlassCard style={styles.loadingContainer}>
            <Animated.View style={[styles.loadingIconContainer, { transform: [{ scale: pulseAnim }] }]}>
              <Text style={styles.loadingIcon}>⌾</Text>
            </Animated.View>

            <Text style={styles.loadingTitle}>Processing Verification</Text>
            <Text style={styles.loadingSubtitle}>{loadingMessage}</Text>

            <View style={styles.progressBarContainer}>
              <View style={styles.progressBarBackground}>
                <Animated.View
                  style={[
                    styles.progressBarFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 100],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>{Math.round(loadingProgress)}%</Text>
            </View>

            <ActivityIndicator size="large" color={theme.colors.accent} style={styles.spinner} />

            <View style={styles.tipsContainer}>
              <Text style={styles.tipsTitle}>Verification insight</Text>
              <Text style={styles.tipsText}>
                The system compares answer detail, delivery quality, and item-specific consistency before producing the result.
              </Text>
            </View>

            <Text style={styles.pleaseWaitText}>Please keep the app open until the result screen appears.</Text>
          </GlassCard>
        </View>
      </Modal>
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
      paddingBottom: 120,
    },
    headerCard: {
      marginBottom: theme.spacing.lg,
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
    questionCard: {
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
      marginBottom: theme.spacing.md,
    },
    recordButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
    },
    recordIcon: {
      fontSize: 18,
    },
    recordText: {
      ...theme.type.bodyStrong,
      color: theme.colors.inverse,
    },
    videoAnswerContainer: {
      backgroundColor: theme.colors.successSoft,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      borderWidth: 1,
      borderColor: theme.colors.success,
    },
    videoRecordedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    videoRecordedIcon: {
      fontSize: 18,
      color: theme.colors.success,
    },
    videoRecordedText: {
      ...theme.type.bodyStrong,
      color: theme.colors.success,
    },
    videoActions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    viewVideoButton: {
      flex: 1,
      backgroundColor: theme.colors.accent,
      paddingVertical: 10,
      borderRadius: theme.radius.sm,
      alignItems: 'center',
    },
    viewVideoText: {
      ...theme.type.caption,
      color: theme.colors.inverse,
      fontWeight: '700',
    },
    removeVideoButton: {
      flex: 1,
      backgroundColor: theme.colors.danger,
      paddingVertical: 10,
      borderRadius: theme.radius.sm,
      alignItems: 'center',
    },
    removeVideoText: {
      ...theme.type.caption,
      color: theme.colors.inverse,
      fontWeight: '700',
    },
    infoBox: {
      marginBottom: theme.spacing.md,
    },
    infoTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.md,
    },
    infoText: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.sm,
    },
    footer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: theme.colors.card,
      padding: theme.spacing.lg,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    loadingOverlay: {
      flex: 1,
      backgroundColor: theme.colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: theme.spacing.lg,
    },
    loadingContainer: {
      width: '100%',
      maxWidth: 420,
      alignItems: 'center',
    },
    loadingIconContainer: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: theme.colors.accentSoft,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: theme.spacing.lg,
    },
    loadingIcon: {
      fontSize: 34,
      color: theme.colors.accent,
    },
    loadingTitle: {
      ...theme.type.title,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.sm,
      textAlign: 'center',
    },
    loadingSubtitle: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.lg,
      textAlign: 'center',
      paddingHorizontal: theme.spacing.sm,
    },
    progressBarContainer: {
      width: '100%',
      marginBottom: theme.spacing.lg,
    },
    progressBarBackground: {
      width: '100%',
      height: 10,
      backgroundColor: theme.colors.inputMuted,
      borderRadius: 5,
      overflow: 'hidden',
      marginBottom: theme.spacing.sm,
    },
    progressBarFill: {
      height: '100%',
      backgroundColor: theme.colors.accent,
      borderRadius: 5,
    },
    progressText: {
      ...theme.type.bodyStrong,
      color: theme.colors.accent,
      textAlign: 'center',
    },
    spinner: {
      marginVertical: theme.spacing.md,
    },
    tipsContainer: {
      backgroundColor: theme.colors.warningSoft,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      marginTop: theme.spacing.sm,
      width: '100%',
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.warning,
    },
    tipsTitle: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.sm,
    },
    tipsText: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      lineHeight: 20,
    },
    pleaseWaitText: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
      marginTop: theme.spacing.md,
      textAlign: 'center',
    },
  });

export default AnswerQuestionsVideoScreen;
