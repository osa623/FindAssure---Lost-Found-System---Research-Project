import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { CameraType, CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useAppTheme } from '../context/ThemeContext';

const MAX_DURATION = 5000;

interface VideoRecorderProps {
  onVideoRecorded: (videoUri: string) => void;
  onCancel: () => void;
  questionNumber: number;
}

export const VideoRecorder: React.FC<VideoRecorderProps> = ({
  onVideoRecorded,
  onCancel,
  questionNumber,
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [facing, setFacing] = useState<CameraType>('front');
  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [isRecording, setIsRecording] = useState(false);
  const [recordedVideoUri, setRecordedVideoUri] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
    };
  }, []);

  if (!permission || !micPermission) {
    return <View style={styles.container} />;
  }

  const hasCamera = !!permission.granted;
  const hasMic = !!micPermission.granted;

  const resetRecording = () => {
    setIsRecording(false);
    setRecordedVideoUri(null);
    setRecordingTime(0);
    setShowPreview(false);

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
  };

  const startRecording = async () => {
    try {
      if (!cameraRef.current) return;

      setIsRecording(true);
      setRecordingTime(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 100);
      }, 100);

      maxDurationTimerRef.current = setTimeout(() => {
        stopRecording();
      }, MAX_DURATION);

      const video = await cameraRef.current.recordAsync({
        maxDuration: 5,
      });

      if (video?.uri) {
        setRecordedVideoUri(video.uri);
        setShowPreview(true);
      }
    } catch (error) {
      console.error('Recording failed:', error);
      Alert.alert('Recording failed', 'Failed to start recording. Please try again.');
      resetRecording();
    }
  };

  const stopRecording = async () => {
    try {
      if (cameraRef.current && isRecording) {
        await cameraRef.current.stopRecording();
      }

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (maxDurationTimerRef.current) {
        clearTimeout(maxDurationTimerRef.current);
        maxDurationTimerRef.current = null;
      }

      setIsRecording(false);
    } catch (error) {
      console.error('Stop recording failed:', error);
      resetRecording();
    }
  };

  const formatTime = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const ms = Math.floor((milliseconds % 1000) / 100);
    return `${seconds}.${ms}s`;
  };

  if (!hasCamera || !hasMic) {
    return (
      <Modal visible animationType="slide" onRequestClose={onCancel}>
        <View style={styles.container}>
          <View style={styles.permissionContainer}>
            <Text style={styles.permissionTitle}>Permissions required</Text>
            <Text style={styles.permissionText}>
              Camera and microphone permissions are required to record video answers.
            </Text>
            <TouchableOpacity
              style={styles.permissionButton}
              onPress={async () => {
                await requestPermission();
                await requestMicPermission();
              }}
            >
              <Text style={styles.permissionButtonText}>Grant Permission</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <View style={styles.container}>
        {!showPreview ? (
          <CameraView ref={cameraRef} style={styles.camera} facing={facing} mode="video">
            <View style={styles.overlay}>
              <View style={styles.header}>
                <TouchableOpacity style={styles.headerButton} onPress={onCancel}>
                  <Text style={styles.headerButtonText}>✕</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Question {questionNumber}</Text>
                <TouchableOpacity
                  style={styles.headerButton}
                  onPress={() => setFacing((current) => (current === 'back' ? 'front' : 'back'))}
                >
                  <Text style={styles.headerButtonText}>↺</Text>
                </TouchableOpacity>
              </View>

              {isRecording ? (
                <View style={styles.recordingIndicator}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingText}>Recording: {formatTime(recordingTime)} / 5.0s</Text>
                </View>
              ) : (
                <View style={styles.instructionsContainer}>
                  <Text style={styles.instructionsText}>Press the button to start recording.</Text>
                  <Text style={styles.instructionsSubtext}>Maximum duration: 5 seconds</Text>
                </View>
              )}

              <View style={styles.controls}>
                <TouchableOpacity
                  style={[styles.recordButton, isRecording && styles.recordButtonActive]}
                  onPress={isRecording ? stopRecording : startRecording}
                >
                  <View style={[styles.recordButtonInner, isRecording && styles.recordButtonInnerActive]} />
                </TouchableOpacity>
              </View>
            </View>
          </CameraView>
        ) : (
          <View style={styles.previewContainer}>
            <View style={styles.previewHeader}>
              <Text style={styles.headerTitle}>Preview - Question {questionNumber}</Text>
            </View>

            <Video
              source={{ uri: recordedVideoUri! }}
              style={styles.preview}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              isLooping
              shouldPlay
            />

            <View style={styles.previewControls}>
              <TouchableOpacity style={styles.retakeButton} onPress={resetRecording}>
                <Text style={styles.retakeButtonText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.useButton} onPress={() => recordedVideoUri && onVideoRecorded(recordedVideoUri)}>
                <Text style={styles.useButtonText}>Use This Video</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.isDark ? '#000000' : theme.colors.inverse,
    },
    permissionContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: theme.spacing.xl,
      backgroundColor: theme.colors.background,
    },
    permissionTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.sm,
      textAlign: 'center',
    },
    permissionText: {
      ...theme.type.body,
      textAlign: 'center',
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.lg,
      lineHeight: 24,
    },
    permissionButton: {
      backgroundColor: theme.colors.accent,
      paddingHorizontal: 32,
      paddingVertical: 16,
      borderRadius: theme.radius.md,
      marginBottom: theme.spacing.sm,
    },
    permissionButtonText: {
      ...theme.type.bodyStrong,
      color: theme.colors.onTint,
    },
    cancelButton: {
      paddingHorizontal: 32,
      paddingVertical: 16,
    },
    cancelButtonText: {
      ...theme.type.bodyStrong,
      color: theme.colors.textMuted,
    },
    camera: {
      flex: 1,
    },
    overlay: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 50,
      paddingHorizontal: 20,
      paddingBottom: 20,
    },
    headerButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerButtonText: {
      color: '#FFFFFF',
      fontSize: 22,
      fontWeight: '400',
    },
    headerTitle: {
      ...theme.type.bodyStrong,
      color: '#FFFFFF',
    },
    recordingIndicator: {
      position: 'absolute',
      top: 120,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(220, 38, 38, 0.9)',
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
    },
    recordingDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: '#FFFFFF',
      marginRight: 8,
    },
    recordingText: {
      ...theme.type.caption,
      color: '#FFFFFF',
      fontWeight: '700',
    },
    instructionsContainer: {
      position: 'absolute',
      top: '40%',
      alignSelf: 'center',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.xl,
    },
    instructionsText: {
      ...theme.type.bodyStrong,
      color: '#FFFFFF',
      textAlign: 'center',
      marginBottom: theme.spacing.sm,
    },
    instructionsSubtext: {
      ...theme.type.body,
      color: 'rgba(255,255,255,0.82)',
      textAlign: 'center',
    },
    controls: {
      position: 'absolute',
      bottom: 40,
      alignSelf: 'center',
    },
    recordButton: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: 'rgba(255, 255, 255, 0.3)',
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 4,
      borderColor: '#FFFFFF',
    },
    recordButtonActive: {
      backgroundColor: 'rgba(220, 38, 38, 0.3)',
      borderColor: '#DC2626',
    },
    recordButtonInner: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: '#DC2626',
    },
    recordButtonInnerActive: {
      borderRadius: 8,
      width: 30,
      height: 30,
    },
    previewContainer: {
      flex: 1,
      backgroundColor: theme.isDark ? '#000000' : theme.colors.header,
    },
    previewHeader: {
      paddingTop: 56,
      paddingBottom: 16,
      alignItems: 'center',
      backgroundColor: theme.isDark ? '#000000' : theme.colors.header,
    },
    preview: {
      flex: 1,
      width: '100%',
    },
    previewControls: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      padding: theme.spacing.lg,
      paddingBottom: 40,
      backgroundColor: theme.isDark ? '#000000' : theme.colors.header,
    },
    retakeButton: {
      flex: 1,
      backgroundColor: theme.colors.textMuted,
      paddingVertical: 16,
      borderRadius: theme.radius.md,
      marginRight: 10,
      alignItems: 'center',
    },
    retakeButtonText: {
      ...theme.type.bodyStrong,
      color: theme.colors.onTint,
    },
    useButton: {
      flex: 1,
      backgroundColor: theme.colors.success,
      paddingVertical: 16,
      borderRadius: theme.radius.md,
      marginLeft: 10,
      alignItems: 'center',
    },
    useButtonText: {
      ...theme.type.bodyStrong,
      color: theme.colors.onTint,
    },
  });
