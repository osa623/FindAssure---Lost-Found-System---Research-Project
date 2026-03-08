import AsyncStorage from '@react-native-async-storage/async-storage';
import { createStackNavigator } from '@react-navigation/stack';
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAppTheme } from '../context/ThemeContext';
import { LoadingScreen } from '../components/LoadingScreen';
import HomeScreen from '../screens/HomeScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import FAQScreen from '../screens/FAQScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import AdminItemDetailScreen from '../screens/admin/AdminItemDetailScreen';
import AdminLoginScreen from '../screens/admin/AdminLoginScreen';
import AdminUsersScreen from '../screens/admin/AdminUsersScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import ProfileScreen from '../screens/auth/ProfileScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import ReportFoundAnswersScreen from '../screens/founder/ReportFoundAnswersScreen';
import ReportFoundDetailsScreen from '../screens/founder/ReportFoundDetailsScreen';
import ReportFoundLocationScreen from '../screens/founder/ReportFoundLocationScreen';
import ReportFoundQuestionsScreen from '../screens/founder/ReportFoundQuestionsScreen';
import ReportFoundStartScreen from '../screens/founder/ReportFoundStartScreen';
import ReportFoundSuccessScreen from '../screens/founder/ReportFoundSuccessScreen';
import AnswerQuestionsVideoScreen from '../screens/owner/AnswerQuestionsVideoScreen';
import FindLostResultsScreen from '../screens/owner/FindLostResultsScreen';
import FindLostStartScreen from '../screens/owner/FindLostStartScreen';
import ItemDetailScreen from '../screens/owner/ItemDetailScreen';
import VerificationPendingScreen from '../screens/owner/VerificationPendingScreen';
import VerificationResultScreen from '../screens/owner/VerificationResultScreen';
import { RootStackParamList } from '../types/models';

const Stack = createStackNavigator<RootStackParamList>();

export const RootNavigator = () => {
  const { loading } = useAuth();
  const { theme } = useAppTheme();
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    const checkOnboardingStatus = async () => {
      try {
        const value = await AsyncStorage.getItem('hasSeenOnboarding');
        setHasSeenOnboarding(value === 'true');
      } catch (error) {
        console.error('Error checking onboarding status:', error);
        setHasSeenOnboarding(false);
      }
    };

    checkOnboardingStatus();
  }, []);

  const screenOptions = useMemo(
    () => ({
      cardStyle: {
        backgroundColor: theme.colors.background,
      },
      headerTransparent: false,
      headerStyle: {
        backgroundColor: theme.colors.header,
        elevation: 0,
        shadowOpacity: 0,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      headerTintColor: theme.colors.textStrong,
      headerTitleStyle: {
        ...theme.type.cardTitle,
        color: theme.colors.textStrong,
      },
      headerTitleAlign: 'center' as const,
      headerBackTitle: '',
      headerShadowVisible: false,
      contentStyle: {
        backgroundColor: theme.colors.background,
      },
    }),
    [theme]
  );

  if (loading || hasSeenOnboarding === null) {
    return <LoadingScreen message="Setting things up" subtitle="Preparing your workspace." />;
  }

  const initialRouteName = hasSeenOnboarding ? 'Home' : 'Onboarding';

  return (
    <Stack.Navigator initialRouteName={initialRouteName} screenOptions={screenOptions}>
      <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'FindAssure',
          headerTitleStyle: {
            ...theme.type.cardTitle,
            color: theme.colors.textStrong,
          },
        }}
      />

      <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Login' }} />
      <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Register' }} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: 'Reset Password' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen name="FAQ" component={FAQScreen} options={{ title: 'FAQ' }} />

      <Stack.Screen name="ReportFoundStart" component={ReportFoundStartScreen} options={{ title: 'Report Found Item' }} />
      <Stack.Screen name="ReportFoundDetails" component={ReportFoundDetailsScreen} options={{ title: 'Item Details' }} />
      <Stack.Screen name="ReportFoundQuestions" component={ReportFoundQuestionsScreen} options={{ title: 'Select Questions' }} />
      <Stack.Screen name="ReportFoundAnswers" component={ReportFoundAnswersScreen} options={{ title: 'Answer Questions' }} />
      <Stack.Screen name="ReportFoundLocation" component={ReportFoundLocationScreen} options={{ title: 'Location & Contact' }} />
      <Stack.Screen name="ReportFoundSuccess" component={ReportFoundSuccessScreen} options={{ headerShown: false }} />

      <Stack.Screen name="FindLostStart" component={FindLostStartScreen} options={{ title: 'Find Lost Item' }} />
      <Stack.Screen name="FindLostResults" component={FindLostResultsScreen} options={{ title: 'Search Results' }} />
      <Stack.Screen name="ItemDetail" component={ItemDetailScreen} options={{ title: 'Item Details' }} />
      <Stack.Screen name="AnswerQuestionsVideo" component={AnswerQuestionsVideoScreen} options={{ title: 'Verify Ownership' }} />
      <Stack.Screen name="VerificationPending" component={VerificationPendingScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="VerificationResult"
        component={VerificationResultScreen}
        options={{ title: 'Verification Result' }}
      />

      <Stack.Screen name="AdminLogin" component={AdminLoginScreen} options={{ title: 'Admin Login' }} />
      <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: 'Admin Dashboard' }} />
      <Stack.Screen name="AdminItemDetail" component={AdminItemDetailScreen} options={{ title: 'Item Details (Admin)' }} />
      <Stack.Screen name="AdminUsers" component={AdminUsersScreen} options={{ title: 'User Management' }} />
    </Stack.Navigator>
  );
};
