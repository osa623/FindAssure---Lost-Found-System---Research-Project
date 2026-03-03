import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  Dimensions,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MAX_DURATION = 5000; // 5 seconds in milliseconds

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
  const [facing, setFacing] = useState<CameraType>('front');
  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [isRecording, setIsRecording] = useState(false);
  const [recordedVideoUri, setRecordedVideoUri] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  
  const cameraRef = useRef<CameraView>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const maxDurationTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup timers on unmount
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (maxDurationTimerRef.current) {
        clearTimeout(maxDurationTimerRef.current);
      }
    };
  }, []);

  if (!permission || !micPermission) {
    return <View style={styles.container} />;
  }

  const hasCamera = !!permission.granted;
  const hasMic = !!micPermission.granted;

  if (!hasCamera || !hasMic) {
    return (
      <View style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>
            Camera and microphone permissions are required to record video answers
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
    );
  }

  const startRecording = async () => {
    try {
      if (!cameraRef.current) return;

      setIsRecording(true);
      setRecordingTime(0);

      // Start the recording timer (updates every 100ms for smooth display)
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 100);
      }, 100);

      // Set max duration timer to auto-stop at 5 seconds
      maxDurationTimerRef.current = setTimeout(() => {
        stopRecording();
      }, MAX_DURATION);

      const video = await cameraRef.current.recordAsync({
        maxDuration: 5,
        mute: false,
        // Quality options for smaller file size
        videoBitrate: 1000000, // 1 Mbps
      });

      if (video && video.uri) {
        setRecordedVideoUri(video.uri);
        setShowPreview(true);
      }
    } catch (error) {
      console.error('Recording failed:', error);
      Alert.alert('Error', 'Failed to start recording. Please try again.');
      resetRecording();
    }
  };

  const stopRecording = async () => {
    try {
      if (cameraRef.current && isRecording) {
        await cameraRef.current.stopRecording();
      }
      
      // Clear timers
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

  const handleRetake = () => {
    resetRecording();
  };

  const handleUseVideo = () => {
    if (recordedVideoUri) {
      onVideoRecorded(recordedVideoUri);
    }
  };

  const toggleCameraFacing = () => {
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  };

  const formatTime = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const ms = Math.floor((milliseconds % 1000) / 100);
    return `${seconds}.${ms}s`;
  };

  return (
    <Modal visible={true} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.container}>
        {!showPreview ? (
          <>
            {/* Camera View */}
            <CameraView 
              ref={cameraRef} 
              style={styles.camera} 
              facing={facing}
              mode="video"
            >
              <View style={styles.overlay}>
                {/* Header */}
                <View style={styles.header}>
                  <TouchableOpacity style={styles.closeButton} onPress={onCancel}>
                    <Text style={styles.closeButtonText}>✕</Text>
                  </TouchableOpacity>
                  <Text style={styles.headerTitle}>Question {questionNumber}</Text>
                  <TouchableOpacity style={styles.flipButton} onPress={toggleCameraFacing}>
                    <Text style={styles.flipButtonText}>🔄</Text>
                  </TouchableOpacity>
                </View>

                {/* Recording Indicator */}
                {isRecording && (
                  <View style={styles.recordingIndicator}>
                    <View style={styles.recordingDot} />
                    <Text style={styles.recordingText}>
                      Recording: {formatTime(recordingTime)} / 5.0s
                    </Text>
                  </View>
                )}

                {/* Instructions */}
                {!isRecording && (
                  <View style={styles.instructionsContainer}>
                    <Text style={styles.instructionsText}>
                      Press the button to start recording
                    </Text>
                    <Text style={styles.instructionsSubtext}>
                      Maximum duration: 5 seconds
                    </Text>
                  </View>
                )}

                {/* Controls */}
                <View style={styles.controls}>
                  <TouchableOpacity
                    style={[
                      styles.recordButton,
                      isRecording && styles.recordButtonActive,
                    ]}
                    onPress={isRecording ? stopRecording : startRecording}
                  >
                    <View
                      style={[
                        styles.recordButtonInner,
                        isRecording && styles.recordButtonInnerActive,
                      ]}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            </CameraView>
          </>
        ) : (
          <>
            {/* Video Preview */}
            <View style={styles.previewContainer}>
              <View style={styles.header}>
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
                <TouchableOpacity style={styles.retakeButton} onPress={handleRetake}>
                  <Text style={styles.retakeButtonText}>🔄 Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.useButton} onPress={handleUseVideo}>
                  <Text style={styles.useButtonText}>✓ Use This Video</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  permissionText: {
    fontSize: 16,
    textAlign: 'center',
    color: '#333',
    marginBottom: 20,
    lineHeight: 24,
  },
  permissionButton: {
    backgroundColor: '#4A90E2',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '500',
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
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '300',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  flipButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flipButtonText: {
    fontSize: 20,
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
    backgroundColor: '#fff',
    marginRight: 8,
  },
  recordingText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  instructionsContainer: {
    position: 'absolute',
    top: '40%',
    alignSelf: 'center',
    alignItems: 'center',
  },
  instructionsText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  instructionsSubtext: {
    color: '#ddd',
    fontSize: 14,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
    borderColor: '#fff',
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
    backgroundColor: '#000',
  },
  preview: {
    flex: 1,
    width: '100%',
  },
  previewControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 20,
    paddingBottom: 40,
    backgroundColor: '#000',
  },
  retakeButton: {
    flex: 1,
    backgroundColor: '#666',
    paddingVertical: 16,
    borderRadius: 12,
    marginRight: 10,
    alignItems: 'center',
  },
  retakeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  useButton: {
    flex: 1,
    backgroundColor: '#10B981',
    paddingVertical: 16,
    borderRadius: 12,
    marginLeft: 10,
    alignItems: 'center',
  },
  useButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
