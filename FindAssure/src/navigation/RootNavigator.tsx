import React, { useState, useEffect } from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { useAuth } from '../context/AuthContext';
import { RootStackParamList } from '../types/models';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LoadingScreen } from '../components/LoadingScreen';
import { palette, type } from '../theme/designSystem';

// Import screens
import OnboardingScreen from '../screens/OnboardingScreen';
import HomeScreen from '../screens/HomeScreen';

// Auth screens
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import ProfileScreen from '../screens/auth/ProfileScreen';

// Founder screens
import ReportFoundStartScreen from '../screens/founder/ReportFoundStartScreen';
import ReportFoundDetailsScreen from '../screens/founder/ReportFoundDetailsScreen';
import ReportFoundQuestionsScreen from '../screens/founder/ReportFoundQuestionsScreen';
import ReportFoundAnswersScreen from '../screens/founder/ReportFoundAnswersScreen';
import ReportFoundLocationScreen from '../screens/founder/ReportFoundLocationScreen';
import ReportFoundSuccessScreen from '../screens/founder/ReportFoundSuccessScreen';

// Owner screens
import FindLostStartScreen from '../screens/owner/FindLostStartScreen';
import FindLostResultsScreen from '../screens/owner/FindLostResultsScreen';
import ItemDetailScreen from '../screens/owner/ItemDetailScreen';
import AnswerQuestionsVideoScreen from '../screens/owner/AnswerQuestionsVideoScreen';
import VerificationPendingScreen from '../screens/owner/VerificationPendingScreen';
import VerificationResultScreen from '../screens/owner/VerificationResultScreen';

// Admin screens
import AdminLoginScreen from '../screens/admin/AdminLoginScreen';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import AdminItemDetailScreen from '../screens/admin/AdminItemDetailScreen';
import AdminUsersScreen from '../screens/admin/AdminUsersScreen';

const Stack = createStackNavigator<RootStackParamList>();

export const RootNavigator = () => {
  const { loading } = useAuth();
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  const checkOnboardingStatus = async () => {
    try {
      const value = await AsyncStorage.getItem('hasSeenOnboarding');
      setHasSeenOnboarding(value === 'true');
    } catch (error) {
      console.error('Error checking onboarding status:', error);
      setHasSeenOnboarding(false);
    }
  };

  if (loading || hasSeenOnboarding === null) {
    return <LoadingScreen message="Initializing..." />;
  }

  const initialRouteName = hasSeenOnboarding ? 'Home' : 'Onboarding';

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{
        cardStyle: {
          backgroundColor: palette.paper,
        },
        headerTransparent: false,
        headerStyle: {
          backgroundColor: palette.paper,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: palette.line,
        },
        headerTintColor: palette.ink,
        headerTitleStyle: {
          ...type.cardTitle,
        },
        headerTitleAlign: 'center',
        headerBackTitle: '',
        headerShadowVisible: false,
      }}
    >
      {/* Onboarding Screen */}
      <Stack.Screen 
        name="Onboarding" 
        component={OnboardingScreen} 
        options={{ headerShown: false }}
      />
      
      {/* Main Screens */}
      <Stack.Screen 
        name="Home" 
        component={HomeScreen} 
        options={({ navigation }) => ({
          title: 'Find Assure',
          headerRight: () => {
            // This will be handled by HomeScreen's useLayoutEffect
            return null;
          },
        })}
      />
      
      {/* Auth Screens */}
      <Stack.Screen 
        name="Login" 
        component={LoginScreen} 
        options={{ title: 'Login' }}
      />
      <Stack.Screen 
        name="Register" 
        component={RegisterScreen} 
        options={{ title: 'Register' }}
      />
      <Stack.Screen 
        name="ForgotPassword" 
        component={ForgotPasswordScreen} 
        options={{ title: 'Reset Password' }}
      />
      <Stack.Screen 
        name="Profile" 
        component={ProfileScreen} 
        options={{ title: 'Profile' }}
      />
      
      {/* Founder Flow */}
      <Stack.Screen 
        name="ReportFoundStart" 
        component={ReportFoundStartScreen} 
        options={{ title: 'Report Found Item' }}
      />
      <Stack.Screen 
        name="ReportFoundDetails" 
        component={ReportFoundDetailsScreen} 
        options={{ title: 'Item Details' }}
      />
      <Stack.Screen 
        name="ReportFoundQuestions" 
        component={ReportFoundQuestionsScreen} 
        options={{ title: 'Select Questions' }}
      />
      <Stack.Screen 
        name="ReportFoundAnswers" 
        component={ReportFoundAnswersScreen} 
        options={{ title: 'Answer Questions' }}
      />
      <Stack.Screen 
        name="ReportFoundLocation" 
        component={ReportFoundLocationScreen} 
        options={{ title: 'Location & Contact' }}
      />
      <Stack.Screen 
        name="ReportFoundSuccess" 
        component={ReportFoundSuccessScreen} 
        options={{ headerShown: false }}
      />
      
      {/* Owner Flow */}
      <Stack.Screen 
        name="FindLostStart" 
        component={FindLostStartScreen} 
        options={{ title: 'Find Lost Item' }}
      />
      <Stack.Screen 
        name="FindLostResults" 
        component={FindLostResultsScreen} 
        options={{ title: 'Search Results' }}
      />
      <Stack.Screen 
        name="ItemDetail" 
        component={ItemDetailScreen} 
        options={{ title: 'Item Details' }}
      />
      <Stack.Screen 
        name="AnswerQuestionsVideo" 
        component={AnswerQuestionsVideoScreen} 
        options={{ title: 'Verify Ownership' }}
      />
      <Stack.Screen 
        name="VerificationPending" 
        component={VerificationPendingScreen} 
        options={{ headerShown: false }}
      />
      <Stack.Screen 
        name="VerificationResult" 
        component={VerificationResultScreen} 
        options={{ title: 'Verification Result' }}
      />
      
      {/* Admin Flow */}
      <Stack.Screen 
        name="AdminLogin" 
        component={AdminLoginScreen} 
        options={{ title: 'Admin Login' }}
      />
      <Stack.Screen 
        name="AdminDashboard" 
        component={AdminDashboardScreen} 
        options={{ title: 'Admin Dashboard' }}
      />
      <Stack.Screen 
        name="AdminItemDetail" 
        component={AdminItemDetailScreen} 
        options={{ title: 'Item Details (Admin)' }}
      />
      <Stack.Screen 
        name="AdminUsers" 
        component={AdminUsersScreen} 
        options={{ title: 'User Management' }}
      />
    </Stack.Navigator>
  );
};
