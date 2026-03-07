// ReportFoundLocationScreen – follow the spec
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
import { LocationPicker } from '../../components/LocationPicker';
import { LocationDetail } from '../../constants/locationData';
import { itemsApi } from '../../api/itemsApi';
import { useAuth } from '../../context/AuthContext';

type ReportFoundLocationNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundLocation'>;
type ReportFoundLocationRouteProp = RouteProp<RootStackParamList, 'ReportFoundLocation'>;

const ReportFoundLocationScreen = () => {
  const navigation = useNavigation<ReportFoundLocationNavigationProp>();
  const route = useRoute<ReportFoundLocationRouteProp>();
  const { images, preAnalysisToken, category, description, selectedQuestions, founderAnswers } = route.params;
  const { user } = useAuth(); // Get logged-in user data

  const [location, setLocation] = useState<LocationDetail | null>(null);
  const [founderName, setFounderName] = useState('');
  const [founderEmail, setFounderEmail] = useState('');
  const [founderPhone, setFounderPhone] = useState('');
  const [loading, setLoading] = useState(false);

  // Auto-fill contact fields from logged-in user profile
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

    // For founder, if building has floors, must select hall
    if (location.floor_id && !location.hall_name) {
      Alert.alert('Required Fields', 'Please select the specific hall where you found the item');
      return;
    }

    try {
      setLoading(true);

      console.log('📝 Submitting found item...');
      await itemsApi.reportFoundItem({
        images,
        preAnalysisToken,
        category,
        description,
        questions: selectedQuestions,
        founderAnswers,
        found_location: [{
          location: location.location,
          floor_id: location.floor_id,
          hall_name: location.hall_name,
        }],
        founderContact: {
          name: founderName.trim(),
          email: founderEmail.trim(),
          phone: founderPhone.trim(),
        },
      });

      console.log('✅ Found item submitted successfully');
      navigation.navigate('ReportFoundSuccess');
    } catch (error: any) {
      console.error('❌ Submission failed:', error);
      Alert.alert(
        'Submission Failed', 
        error.message || 'Could not submit the found item. Please try again.'
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
            <Text style={styles.title}>Location & Contact Info</Text>
            <Text style={styles.subtitle}>
              Where did you find the item and how can the owner reach you?
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📍 Location Details</Text>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Where did you find it? *</Text>
                <LocationPicker
                  selectedValue={location}
                  onValueChange={setLocation}
                  userType="founder"
                  error={!location ? undefined : ''}
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>👤 Your Contact Information</Text>
              {user && (
                <Text style={styles.autoFillHint}>
                  ✓ Auto-filled from your profile (you can edit if needed)
                </Text>
              )}
              
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Your Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your full name"
                  value={founderName}
                  onChangeText={setFounderName}
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Your Email *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your email"
                  value={founderEmail}
                  onChangeText={setFounderEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Your Phone Number *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your phone number"
                  value={founderPhone}
                  onChangeText={setFounderPhone}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                />
              </View>
            </View>

            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                ℹ️ Your contact information will only be shared with verified owners after 
                they successfully answer the ownership questions.
              </Text>
            </View>

            <PrimaryButton
              title="Submit Found Item"
              onPress={handleSubmit}
              loading={loading}
              style={styles.submitButton}
            />
          </View>
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
  form: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 8,
  },
  autoFillHint: {
    fontSize: 12,
    color: '#4CAF50',
    marginBottom: 12,
    fontStyle: 'italic',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#DDDDDD',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#FAFAFA',
  },
  textArea: {
    minHeight: 80,
    paddingTop: 12,
  },
  infoBox: {
    backgroundColor: '#FFF3E0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  infoText: {
    fontSize: 13,
    color: '#666666',
    lineHeight: 18,
  },
  submitButton: {
    marginTop: 10,
  },
});

export default ReportFoundLocationScreen;
