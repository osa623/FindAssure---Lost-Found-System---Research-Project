import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { itemsApi } from '../../api/itemsApi';
import { LocationDetail } from '../../constants/locationData';
import { FormInput } from '../../components/FormInput';
import { GlassCard } from '../../components/GlassCard';
import { KeyboardAwareFormScreen } from '../../components/KeyboardAwareFormScreen';
import { LocationPicker } from '../../components/LocationPicker';
import { OverlayLoadingState } from '../../components/OverlayLoadingState';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useAppTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { RootStackParamList } from '../../types/models';

type ReportFoundLocationNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundLocation'>;
type ReportFoundLocationRouteProp = RouteProp<RootStackParamList, 'ReportFoundLocation'>;

const ReportFoundLocationScreen = () => {
  const navigation = useNavigation<ReportFoundLocationNavigationProp>();
  const route = useRoute<ReportFoundLocationRouteProp>();
  const { images, preAnalysisToken, category, description, selectedQuestions, founderAnswers } = route.params;
  const { user } = useAuth();
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [location, setLocation] = useState<LocationDetail | null>(null);
  const [founderName, setFounderName] = useState('');
  const [founderEmail, setFounderEmail] = useState('');
  const [founderPhone, setFounderPhone] = useState('');
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (user) {
      if (user.name) setFounderName(user.name);
      if (user.email) setFounderEmail(user.email);
      if (user.phone) setFounderPhone(user.phone);
    }
  }, [user]);

  const handleSubmit = async () => {
    if (!location || !location.location || !founderName.trim() || !founderEmail.trim() || !founderPhone.trim()) {
      showToast({
        title: 'Missing details',
        message: 'Please complete the location and contact information.',
        variant: 'warning',
      });
      return;
    }
    if (location.floor_id && !location.hall_name) {
      Alert.alert('Required Fields', 'Please select the specific hall where you found the item');
      return;
    }

    try {
      setLoading(true);
      await itemsApi.reportFoundItem({
        images,
        preAnalysisToken,
        category,
        description,
        questions: selectedQuestions,
        founderAnswers,
        found_location: [
          {
            location: location.location,
            floor_id: location.floor_id,
            hall_name: location.hall_name,
          },
        ],
        founderContact: {
          name: founderName.trim(),
          email: founderEmail.trim(),
          phone: founderPhone.trim(),
        },
      });
      showToast({
        title: 'Report submitted',
        message: 'The item was added successfully.',
        variant: 'success',
      });
      navigation.navigate('ReportFoundSuccess');
    } catch (error: any) {
      showToast({
        title: 'Submission failed',
        message: error.message || 'Could not submit the found item. Please try again.',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAwareFormScreen contentContainerStyle={styles.content}>
        <GlassCard style={styles.hero}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Final step</Text>
          </View>
          <Text style={styles.heroEyebrow}>Location & contact</Text>
          <Text style={styles.heroTitle}>Pin the location and share contact details.</Text>
          <Text style={styles.heroBody}>Finder contact information remains hidden until an owner is verified successfully.</Text>
        </GlassCard>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Location</Text>
          <Text style={styles.sectionTitle}>Where was the item found?</Text>
          <LocationPicker selectedValue={location} onValueChange={setLocation} userType="founder" error={!location ? undefined : ''} />
        </GlassCard>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Finder contact</Text>
          <Text style={styles.sectionTitle}>How verified owners will reach you</Text>
          {user ? <Text style={styles.autoFillHint}>Auto-filled from your profile. You can still edit it here.</Text> : null}
          <FormInput
            label="Your name"
            placeholder="Enter your full name"
            value={founderName}
            onChangeText={setFounderName}
            autoCapitalize="words"
            containerStyle={styles.fieldGap}
          />
          <FormInput
            label="Your email"
            placeholder="Enter your email"
            value={founderEmail}
            onChangeText={setFounderEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            containerStyle={styles.fieldGap}
          />
          <FormInput
            label="Your phone number"
            placeholder="Enter your phone number"
            value={founderPhone}
            onChangeText={setFounderPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
        </GlassCard>

        <GlassCard style={styles.cardGap}>
          <Text style={styles.sectionEyebrow}>Privacy</Text>
          <Text style={styles.sectionBody}>Contact details are revealed only after the owner passes the verification process.</Text>
        </GlassCard>

        <PrimaryButton title="Submit Found Item" onPress={handleSubmit} loading={loading} size="lg" />
      </KeyboardAwareFormScreen>

      <OverlayLoadingState
        visible={loading}
        title="Submitting your report"
        message="Saving the report and preparing it for owner search."
      />
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    content: {
      paddingTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
    },
    hero: {
      padding: theme.spacing.lg,
      marginBottom: theme.spacing.md,
    },
    heroBadge: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.accentSoft,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      marginBottom: theme.spacing.sm,
    },
    heroBadgeText: {
      ...theme.type.caption,
      color: theme.colors.accent,
      fontWeight: '700',
    },
    heroEyebrow: {
      ...theme.type.label,
      color: theme.colors.accent,
      marginBottom: theme.spacing.xs,
    },
    heroTitle: {
      ...theme.type.title,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.sm,
    },
    heroBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    cardGap: {
      marginBottom: theme.spacing.md,
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
    },
    autoFillHint: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.md,
    },
    fieldGap: {
      marginBottom: theme.spacing.md,
    },
  });

export default ReportFoundLocationScreen;
