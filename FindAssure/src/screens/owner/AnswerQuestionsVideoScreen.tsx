import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
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
import { OverlayLoadingState } from '../../components/OverlayLoadingState';
import { PrimaryButton } from '../../components/PrimaryButton';
import { VideoRecorder } from '../../components/VideoRecorder';
import { useAppTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { OwnerAnswerInput, RootStackParamList } from '../../types/models';

type AnswerQuestionsVideoNavigationProp = StackNavigationProp<RootStackParamList, 'AnswerQuestionsVideo'>;
type AnswerQuestionsVideoRouteProp = RouteProp<RootStackParamList, 'AnswerQuestionsVideo'>;

const LOADING_MESSAGES = [
  'Uploading your video answers securely.',
  'Reviewing answer quality and delivery.',
  'Comparing item-specific details across answers.',
  'Finalizing the verification result.',
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
  const [loadingStageIndex, setLoadingStageIndex] = useState(0);

  useEffect(() => {
    if (!loading) {
      setLoadingStageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setLoadingStageIndex((current) => Math.min(current + 1, LOADING_MESSAGES.length - 1));
    }, 1800);

    return () => {
      clearInterval(interval);
    };
  }, [loading]);

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
      setLoadingStageIndex(0);

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

      setLoadingStageIndex(LOADING_MESSAGES.length - 1);

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
            <Text style={styles.infoText}>Record one short clip per question.</Text>
          <Text style={styles.infoText}>Speak clearly and look at the camera.</Text>
          <Text style={styles.infoText}>Give specific details only the true owner would know.</Text>
          <Text style={styles.infoText}>You can preview, remove, and retake clips before submitting.</Text>
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

      <OverlayLoadingState
        visible={loading}
        badge="Verification review"
        title="Reviewing your answers"
        message={LOADING_MESSAGES[loadingStageIndex]}
        stageLabel={`Step ${Math.min(loadingStageIndex + 1, LOADING_MESSAGES.length)} of ${LOADING_MESSAGES.length}`}
        note="Keep the app open while we finish the ownership review."
        illustrationVariant="pending"
      />
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
      color: theme.colors.onTint,
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
      color: theme.colors.onTint,
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
      color: theme.colors.onTint,
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
  });

export default AnswerQuestionsVideoScreen;
