import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { LocationPicker } from '../../components/LocationPicker';
import { LocationDetail } from '../../constants/locationData';
import { itemsApi } from '../../api/itemsApi';
import { useAuth } from '../../context/AuthContext';
import { FormInput } from '../../components/FormInput';
import { GlassCard } from '../../components/GlassCard';
import { gradients, palette, radius, spacing, type } from '../../theme/designSystem';

type ReportFoundLocationNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundLocation'>;
type ReportFoundLocationRouteProp = RouteProp<RootStackParamList, 'ReportFoundLocation'>;

const ReportFoundLocationScreen = () => {
  const navigation = useNavigation<ReportFoundLocationNavigationProp>();
  const route = useRoute<ReportFoundLocationRouteProp>();
  const { images, preAnalysisToken, category, description, selectedQuestions, founderAnswers } = route.params;
  const { user } = useAuth();

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
      Alert.alert('Required Fields', 'Please fill in all fields including location');
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
      navigation.navigate('ReportFoundSuccess');
    } catch (error: any) {
      Alert.alert('Submission Failed', error.message || 'Could not submit the found item. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={gradients.appBackground} style={styles.container}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content}>
          <GlassCard style={styles.hero}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Final step</Text>
            </View>
            <Text style={styles.heroEyebrow}>Final step</Text>
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
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  hero: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: palette.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    marginBottom: spacing.sm,
  },
  heroBadgeText: {
    ...type.caption,
    color: palette.primaryDeep,
    fontWeight: '700',
  },
  heroEyebrow: {
    ...type.label,
    color: palette.primaryDeep,
    marginBottom: spacing.xs,
  },
  heroTitle: {
    ...type.title,
    color: palette.ink,
    marginBottom: spacing.sm,
  },
  heroBody: {
    ...type.body,
    color: palette.inkSoft,
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
  },
  autoFillHint: {
    ...type.caption,
    marginBottom: spacing.md,
  },
  fieldGap: {
    marginBottom: spacing.md,
  },
});

export default ReportFoundLocationScreen;
