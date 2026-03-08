import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import axiosClient from '../../api/axiosClient';
import { AnimatedHeroIllustration } from '../../components/AnimatedHeroIllustration';
import { GlassCard } from '../../components/GlassCard';
import { LoadingScreen } from '../../components/LoadingScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StaggeredEntrance } from '../../components/StaggeredEntrance';
import { useAppTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { RootStackParamList } from '../../types/models';

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
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [loading, setLoading] = useState(true);
  const [verification, setVerification] = useState<VerificationData | null>(null);

  const fetchVerificationResult = useCallback(async () => {
    try {
      const response = await axiosClient.get(`/items/verification/${verificationId}`);
      setVerification(response.data);
    } catch (error: any) {
      showToast({
        title: 'Could not load result',
        message: error?.response?.data?.message || 'Please try again in a moment.',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [showToast, verificationId]);

  useEffect(() => {
    fetchVerificationResult();
  }, [fetchVerificationResult]);

  const handleGoHome = () => navigation.navigate('Home');

  if (loading) {
    return <LoadingScreen message="Loading verification result" subtitle="Reviewing the latest outcome." />;
  }

  if (!verification) {
    return (
      <LinearGradient colors={theme.gradients.appBackground} style={styles.centerContainer}>
        <Text style={styles.errorText}>Failed to load verification result.</Text>
        <PrimaryButton title="Go Home" onPress={handleGoHome} />
      </LinearGradient>
    );
  }

  const pythonResult = verification.pythonVerificationResult;
  const fallbackAbsoluteOwner = pythonResult?.gemini_recommendation === 'MATCH';
  const isAbsoluteOwner = pythonResult?.is_absolute_owner ?? fallbackAbsoluteOwner;
  const isVerified = verification.status === 'passed' || (verification.status !== 'failed' && !!isAbsoluteOwner);

  return (
    <LinearGradient colors={theme.gradients.appBackground} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <StaggeredEntrance>
          <GlassCard style={styles.heroCard}>
            <View style={styles.heroIllustration}>
              <AnimatedHeroIllustration size={132} variant={isVerified ? 'success' : 'pending'} />
            </View>
            <Text style={[styles.heroEyebrow, { color: isVerified ? theme.colors.success : theme.colors.warning }]}>
              {isVerified ? 'Verified owner' : 'Verification failed'}
            </Text>
            <Text style={styles.heroTitle}>{isVerified ? 'Ownership confirmed.' : 'Ownership not confirmed.'}</Text>
            <Text style={styles.heroBody}>
              {isVerified
                ? 'You can now contact the finder and arrange item retrieval.'
                : 'Your answers did not meet the confidence threshold for this item.'}
            </Text>
            {!isVerified && pythonResult?.rejection_reason ? (
              <Text style={styles.failureReason}>{pythonResult.rejection_reason}</Text>
            ) : null}
          </GlassCard>
        </StaggeredEntrance>

        {isVerified && verification.foundItemId.founderContact ? (
          <StaggeredEntrance delay={80}>
            <GlassCard style={styles.cardGap}>
              <Text style={styles.sectionEyebrow}>Founder contact</Text>
              <Text style={styles.sectionTitle}>Reach out to retrieve your item</Text>
              <Text style={styles.sectionBody}>Name: {verification.foundItemId.founderContact.name}</Text>
              <Text style={styles.sectionBody}>Email: {verification.foundItemId.founderContact.email}</Text>
              <Text style={styles.sectionBody}>Phone: {verification.foundItemId.founderContact.phone}</Text>
            </GlassCard>
          </StaggeredEntrance>
        ) : null}

        {pythonResult?.results && pythonResult.results.length > 0 ? (
          <StaggeredEntrance delay={120}>
            <GlassCard style={styles.cardGap}>
              <Text style={styles.sectionEyebrow}>Question analysis</Text>
              <Text style={styles.sectionTitle}>How each answer scored</Text>
              {pythonResult.results.map((result, index) => (
                <View key={result.question_id || index} style={styles.resultItem}>
                  <View style={styles.resultHeader}>
                    <Text style={styles.resultNumber}>Q{result.question_id}</Text>
                    <Text style={styles.resultSimilarity}>{result.final_similarity}</Text>
                    <View style={[styles.resultStatusBadge, getResultStatusStyle(theme, result.status)]}>
                      <Text style={styles.resultStatusText}>{result.status.replace('_', ' ')}</Text>
                    </View>
                  </View>
                  {result.gemini_analysis ? <Text style={styles.resultAnalysis}>{result.gemini_analysis}</Text> : null}
                </View>
              ))}
            </GlassCard>
          </StaggeredEntrance>
        ) : null}

        {!isVerified ? (
          <StaggeredEntrance delay={160}>
            <GlassCard style={styles.cardGap}>
              <Text style={styles.sectionEyebrow}>Retry</Text>
              <Text style={styles.sectionBody}>
                If you still believe this is your item, try again with more accurate and specific answers.
              </Text>
            </GlassCard>
          </StaggeredEntrance>
        ) : null}

        <StaggeredEntrance delay={200}>
          <PrimaryButton title="Back to Home" onPress={handleGoHome} size="lg" />
        </StaggeredEntrance>
      </ScrollView>
    </LinearGradient>
  );
};

const getResultStatusStyle = (
  theme: ReturnType<typeof useAppTheme>['theme'],
  status: VerificationResult['status']
) => {
  switch (status) {
    case 'match':
      return { backgroundColor: theme.colors.successSoft };
    case 'partial_match':
      return { backgroundColor: theme.colors.warningSoft };
    default:
      return { backgroundColor: theme.colors.dangerSoft };
  }
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: { flex: 1 },
    centerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: theme.spacing.xl,
    },
    content: {
      paddingTop: theme.spacing.lg,
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
    },
    heroCard: {
      padding: theme.spacing.xl,
      alignItems: 'center',
      marginBottom: theme.spacing.lg,
    },
    heroIllustration: {
      marginBottom: theme.spacing.md,
    },
    heroEyebrow: {
      ...theme.type.label,
      marginBottom: theme.spacing.sm,
    },
    heroTitle: {
      ...theme.type.title,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.sm,
      textAlign: 'center',
    },
    heroBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      textAlign: 'center',
    },
    failureReason: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
      marginTop: theme.spacing.md,
      textAlign: 'center',
    },
    errorText: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.lg,
      textAlign: 'center',
    },
    cardGap: {
      marginBottom: theme.spacing.lg,
    },
    sectionEyebrow: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    sectionTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.md,
    },
    sectionBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.sm,
    },
    resultItem: {
      paddingVertical: theme.spacing.md,
      borderTopWidth: 1,
      borderTopColor: theme.colors.line,
    },
    resultHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.xs,
      flexWrap: 'wrap',
    },
    resultNumber: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
    },
    resultSimilarity: {
      ...theme.type.bodyStrong,
      color: theme.colors.accent,
    },
    resultStatusBadge: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 4,
    },
    resultStatusText: {
      ...theme.type.caption,
      color: theme.colors.textStrong,
      textTransform: 'capitalize',
      fontWeight: '700',
    },
    resultAnalysis: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
  });

export default VerificationResultScreen;
