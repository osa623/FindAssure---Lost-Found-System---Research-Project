// ReportFoundDetailsScreen – follow the spec
import React, { useState } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  StyleSheet, 
  Image, 
  ScrollView, 
  Alert,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { CategoryPicker } from '../../components/CategoryPicker';
import { ITEM_CATEGORIES } from '../../constants/appConstants';

type ReportFoundDetailsNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundDetails'>;
type ReportFoundDetailsRouteProp = RouteProp<RootStackParamList, 'ReportFoundDetails'>;

const ReportFoundDetailsScreen = () => {
  const navigation = useNavigation<ReportFoundDetailsNavigationProp>();
  const route = useRoute<ReportFoundDetailsRouteProp>();
  const {
    images,
    preAnalysisToken,
    category: prefilledCategory,
    description: prefilledDescription,
    analysisMessage,
  } = route.params;

  const [category, setCategory] = useState<string>(prefilledCategory || ITEM_CATEGORIES[0]);
  const [description, setDescription] = useState(prefilledDescription || '');

  const handleConfirm = () => {
    if (!category || !description.trim()) {
      Alert.alert('Required Fields', 'Please fill in all fields');
      return;
    }

    navigation.navigate('ReportFoundQuestions', {
      images,
      preAnalysisToken,
      category,
      description: description.trim(),
    });
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageStrip}>
            {images.map((image, index) => (
              <Image
                key={`${image.uri}-${index}`}
                source={{ uri: image.uri }}
                style={[styles.image, index > 0 && styles.imageWithGap]}
                resizeMode="contain"
              />
            ))}
          </ScrollView>
          <Text style={styles.imageHelperText}>
            {images.length === 1
              ? 'Basic analysis will run on this single image.'
              : 'Enhanced multi-view analysis will run across these images.'}
          </Text>

          {analysisMessage ? (
            <View style={styles.analysisMessageBox}>
              <Text style={styles.analysisMessageText}>{analysisMessage}</Text>
            </View>
          ) : null}

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Category *</Text>
              <CategoryPicker
                selectedValue={category}
                onValueChange={setCategory}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Description *</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Provide detailed description of the item..."
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={6}
                textAlignVertical="top"
              />
              <Text style={styles.helperText}>
                Please add specific details. The manual category/description stay public, while pipeline detections stay internal.
              </Text>
            </View>

            <PrimaryButton
              title="Next"
              onPress={handleConfirm}
              style={styles.confirmButton}
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
  image: {
    width: 220,
    height: 250,
    borderRadius: 12,
    backgroundColor: '#E0E0E0',
  },
  imageWithGap: {
    marginLeft: 12,
  },
  imageStrip: {
    marginBottom: 10,
  },
  imageHelperText: {
    fontSize: 13,
    color: '#666666',
    marginBottom: 20,
  },
  analysisMessageBox: {
    backgroundColor: '#E8F4FD',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#4A90E2',
  },
  analysisMessageText: {
    fontSize: 13,
    color: '#335A78',
    lineHeight: 18,
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
  inputGroup: {
    marginBottom: 20,
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
    minHeight: 120,
    paddingTop: 12,
  },
  helperText: {
    fontSize: 12,
    color: '#999999',
    marginTop: 6,
  },
  confirmButton: {
    marginTop: 10,
  },
});

export default ReportFoundDetailsScreen;
