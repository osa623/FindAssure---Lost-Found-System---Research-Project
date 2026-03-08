import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { GlassCard } from '../../components/GlassCard';
import axiosClient from '../../api/axiosClient';
import { gradients, palette, radius, spacing, type } from '../../theme/designSystem';

type VerificationResultRouteProp = RouteProp<RootStackParamList, 'VerificationResult'>;
type VerificationResultNavigationProp = StackNavigationProp<RootStackParamList, 'VerificationResult'>;

interface VerificationResult {
  question_id: number;
  final_similarity: string;
  status: 'match' | 'partial_match' | 'mismatch';
  local_explanation?: string;
  gemini_analysis: string | null;
}

interface PythonVerificationResponse {
  final_confidence?: string;
  is_absolute_owner?: boolean;
  gemini_recommendation?: string;
  gemini_reasoning?: string;
  rejection_reason?: string;
  minimum_question_score?: string;
  semantic_confidence?: string;
  face_confidence_score?: string;
  face_decision?: string;
  has_zero_match_question?: boolean;
  results?: VerificationResult[];
}

interface VerificationData {
  _id: string;
  status: 'pending' | 'passed' | 'failed';
  similarityScore: number | null;
  pythonVerificationResult?: PythonVerificationResponse;
  foundItemId: {
    _id: string;
    category: string;
    description: string;
    imageUrl: string;
    location: string;
    founderContact: {
      name: string;
      email: string;
      phone: string;
    };
  };
}

const VerificationResultScreen = () => {
  const route = useRoute<VerificationResultRouteProp>();
  const navigation = useNavigation<VerificationResultNavigationProp>();
  const { verificationId } = route.params;

  const [loading, setLoading] = useState(true);
  const [verification, setVerification] = useState<VerificationData | null>(null);

  useEffect(() => {
    fetchVerificationResult();
  }, []);

  const fetchVerificationResult = async () => {
    try {
      const response = await axiosClient.get(`/items/verification/${verificationId}`);
      setVerification(response.data);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to fetch verification result');
    } finally {
      setLoading(false);
    }
  };

  const handleGoHome = () => navigation.navigate('Home');

  if (loading) {
    return (
      <LinearGradient colors={gradients.appBackground} style={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.primaryDeep} />
        <Text style={styles.loadingText}>Loading verification result...</Text>
      </LinearGradient>
    );
  }

  if (!verification) {
    return (
      <LinearGradient colors={gradients.appBackground} style={styles.centerContainer}>
        <Text style={styles.errorText}>Failed to load verification result</Text>
        <PrimaryButton title="Go Home" onPress={handleGoHome} />
      </LinearGradient>
    );
  }

  const pythonResult = verification.pythonVerificationResult;
  const fallbackAbsoluteOwner = pythonResult?.gemini_recommendation === 'MATCH';
  const isAbsoluteOwner = pythonResult?.is_absolute_owner ?? fallbackAbsoluteOwner;
  const isVerified = verification.status === 'passed' || (verification.status !== 'failed' && !!isAbsoluteOwner);

  return (
    <LinearGradient colors={gradients.appBackground} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <LinearGradient colors={isVerified ? gradients.success : gradients.violet} style={styles.hero}>
          <Text style={styles.heroEyebrow}>{isVerified ? 'Verified owner' : 'Verification failed'}</Text>
          <Text style={styles.heroTitle}>{isVerified ? 'Ownership confirmed.' : 'Ownership not confirmed.'}</Text>
          <Text style={styles.heroBody}>
            {isVerified
              ? 'You can now contact the finder and arrange item retrieval.'
              : 'Your answers did not meet the confidence threshold for this item.'}
          </Text>
          {!isVerified && pythonResult?.rejection_reason ? <Text style={styles.failureReason}>{pythonResult.rejection_reason}</Text> : null}
        </LinearGradient>

        {isVerified && verification.foundItemId.founderContact ? (
          <GlassCard style={styles.cardGap}>
            <Text style={styles.sectionEyebrow}>Founder contact</Text>
            <Text style={styles.sectionTitle}>Reach out to retrieve your item</Text>
            <Text style={styles.sectionBody}>Name: {verification.foundItemId.founderContact.name}</Text>
            <Text style={styles.sectionBody}>Email: {verification.foundItemId.founderContact.email}</Text>
            <Text style={styles.sectionBody}>Phone: {verification.foundItemId.founderContact.phone}</Text>
          </GlassCard>
        ) : null}

        {pythonResult?.results && pythonResult.results.length > 0 ? (
          <GlassCard style={styles.cardGap}>
            <Text style={styles.sectionEyebrow}>Question analysis</Text>
            <Text style={styles.sectionTitle}>How each answer scored</Text>
            {pythonResult.results.map((result, index) => (
              <View key={result.question_id || index} style={styles.resultItem}>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultNumber}>Q{result.question_id}</Text>
                  <Text style={styles.resultSimilarity}>{result.final_similarity}</Text>
                  <Text style={styles.resultStatus}>{result.status.replace('_', ' ')}</Text>
                </View>
                {result.gemini_analysis ? <Text style={styles.resultAnalysis}>{result.gemini_analysis}</Text> : null}
              </View>
            ))}
          </GlassCard>
        ) : null}

        {!isVerified ? (
          <GlassCard style={styles.cardGap}>
            <Text style={styles.sectionEyebrow}>Retry</Text>
            <Text style={styles.sectionBody}>If you still believe this is your item, try again with more accurate and specific answers.</Text>
          </GlassCard>
        ) : null}

        <PrimaryButton title="Back to Home" onPress={handleGoHome} size="lg" />
      </ScrollView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  content: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  loadingText: {
    ...type.bodyStrong,
    marginTop: spacing.lg,
  },
  errorText: {
    ...type.body,
    marginBottom: spacing.lg,
  },
  hero: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroEyebrow: {
    ...type.label,
    color: 'rgba(255,255,255,0.72)',
    marginBottom: spacing.sm,
  },
  heroTitle: {
    ...type.title,
    color: palette.paperStrong,
    marginBottom: spacing.sm,
  },
  heroBody: {
    ...type.body,
    color: 'rgba(255,255,255,0.82)',
  },
  failureReason: {
    ...type.caption,
    color: 'rgba(255,255,255,0.78)',
    marginTop: spacing.md,
  },
  cardGap: {
    marginBottom: spacing.lg,
  },
  sectionEyebrow: {
    ...type.label,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    ...type.section,
    marginBottom: spacing.md,
  },
  sectionBody: {
    ...type.body,
    marginBottom: spacing.sm,
  },
  resultItem: {
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  resultNumber: {
    ...type.bodyStrong,
  },
  resultSimilarity: {
    ...type.bodyStrong,
    color: palette.primaryDeep,
  },
  resultStatus: {
    ...type.caption,
    textTransform: 'capitalize',
  },
  resultAnalysis: {
    ...type.body,
  },
});

export default VerificationResultScreen;
