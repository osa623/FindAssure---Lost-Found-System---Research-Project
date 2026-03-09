import React, { createContext, useState, useEffect, useContext } from 'react';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  getAuth,
  Auth,
  Dependencies,
  User as FirebaseUser,
  initializeAuth as FirebaseInitializeAuth,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axiosClient from '../api/axiosClient';
import { API_CONFIG, BASE_URL, HEALTH_CHECK_URL } from '../config/api.config';
import { getFriendlyAuthErrorMessage } from '../utils/authErrors';

// Metro supports the package root, but TypeScript does not surface the RN-only helper.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const firebaseNativeAuth = require('@firebase/auth') as {
  initializeAuth: typeof FirebaseInitializeAuth;
  getReactNativePersistence: (storage: typeof AsyncStorage) => Dependencies['persistence'];
};
const { initializeAuth, getReactNativePersistence } = firebaseNativeAuth;

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB-wfz-2qgTCE0moQL-lVWNpWVKVYwiMHc",
  authDomain: "findazzure.firebaseapp.com",
  projectId: "findazzure",
  storageBucket: "findazzure.firebasestorage.app",
  messagingSenderId: "804114580108",
  appId: "1:804114580108:web:0e471566a61b785a6331a9",
  measurementId: "G-YKXTBZ6L6M"
};

// Initialize Firebase
const app: FirebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();

const getOrInitializeAuth = (): Auth => {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (error: any) {
    if (error?.code === 'auth/already-initialized') {
      return getAuth(app);
    }

    throw error;
  }
};

const auth: Auth = getOrInitializeAuth();

interface User {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'owner' | 'admin'; // Only owners and admins register
  createdAt: string;
  updatedAt?: string;
}

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  token: string | null;
  loading: boolean;
  keepLoggedIn: boolean;
  signIn: (credentials: { email: string; password: string; keepLoggedIn?: boolean }) => Promise<void>;
  signUp: (data: { email: string; password: string; name: string; phone?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<User>;
  updateUser: (userData: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [keepLoggedIn, setKeepLoggedIn] = useState(false);
  const tokenRefreshIntervalRef = React.useRef<any>(null);

  // Setup automatic token refresh
  const setupTokenRefresh = (firebaseUser: FirebaseUser) => {
    // Clear any existing interval
    if (tokenRefreshIntervalRef.current) {
      clearInterval(tokenRefreshIntervalRef.current);
    }

    // Refresh token every 45 minutes (tokens expire after 1 hour)
    tokenRefreshIntervalRef.current = setInterval(async () => {
      try {
        console.log('🔄 Auto-refreshing token...');
        const newToken = await firebaseUser.getIdToken(true); // Force refresh
        setToken(newToken);
        (global as any).authToken = newToken;
        axiosClient.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
        console.log('✅ Token refreshed successfully');
      } catch (error) {
        console.error('❌ Token refresh failed:', error);
      }
    }, 45 * 60 * 1000); // 45 minutes
  };

  // Clear token refresh
  const clearTokenRefresh = () => {
    if (tokenRefreshIntervalRef.current) {
      clearInterval(tokenRefreshIntervalRef.current);
      tokenRefreshIntervalRef.current = null;
    }
  };

  // Sync user with backend
  const syncUserWithBackend = async (
    firebaseUser: FirebaseUser,
    forceRefresh = false,
    throwOnError = false
  ) => {
    try {
      const idToken = await firebaseUser.getIdToken(forceRefresh);
      setToken(idToken);
      (global as any).authToken = idToken;

      // Set token for axios requests
      axiosClient.defaults.headers.common['Authorization'] = `Bearer ${idToken}`;

      // ✅ Call backend - user will be auto-created in MongoDB if doesn't exist
      const response = await axiosClient.get('/auth/me');
      setUser(response.data);
      
    } catch (error: any) {
      const friendlyMessage = getFriendlyAuthErrorMessage(
        error,
        'We could not connect your account to the app right now.'
      );
      if (friendlyMessage.toLowerCase().includes('suspended')) {
        if (throwOnError) {
          throw new Error(friendlyMessage);
        }
        console.warn('Suspended user sync blocked');
        return;
      }

      if (throwOnError) {
        throw error;
      }

      console.error('Error syncing with backend:', {
        baseUrl: BASE_URL,
        healthCheckUrl: HEALTH_CHECK_URL,
        backendHost: API_CONFIG.BACKEND_HOST,
        code: error?.code,
        message: error?.message,
        status: error?.response?.status,
        data: error?.response?.data,
      });
      
      // Provide helpful error messages
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        console.error('⚠️ Backend connection timeout. Make sure backend server is running and the IP address is correct.');
      } else if (error.code === 'ERR_NETWORK') {
        console.error('⚠️ Network error. Check your connection and backend IP address.');
      }
      
      // Don't block login, user can still access app with Firebase auth
    }
  };

  useEffect(() => {
    // Load keepLoggedIn preference on mount
    const loadPreferences = async () => {
      try {
        const storedPreference = await AsyncStorage.getItem('keepLoggedIn');
        const shouldKeepLoggedIn = storedPreference === 'true';
        setKeepLoggedIn(shouldKeepLoggedIn);
      } catch (error) {
        console.error('Error loading preferences:', error);
      }
    };

    loadPreferences();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setFirebaseUser(firebaseUser);
      (global as any).firebaseUser = firebaseUser || null;
      setLoading(false);

      if (firebaseUser) {
        await syncUserWithBackend(firebaseUser);
        
        // Get current keepLoggedIn preference
        const storedPreference = await AsyncStorage.getItem('keepLoggedIn');
        const shouldKeepLoggedIn = storedPreference === 'true';
        
        // Setup token refresh if keep logged in is enabled
        if (shouldKeepLoggedIn) {
          setupTokenRefresh(firebaseUser);
        }
      } else {
        setUser(null);
        setToken(null);
        (global as any).authToken = null;
        (global as any).firebaseUser = null;
        delete axiosClient.defaults.headers.common['Authorization'];
        clearTokenRefresh();
      }
    });

    return () => {
      unsubscribe();
      clearTokenRefresh();
    };
  }, []);

  const signUp = async (data: { email: string; password: string; name: string; phone?: string }) => {
    try {
      const { email, password, name, phone } = data;
      
      // 1. Create user in Firebase
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      
      // 2. Get token
      const idToken = await userCredential.user.getIdToken();
      setToken(idToken);
      (global as any).authToken = idToken;

      // 3. Register with backend (creates MongoDB user with all details)
      const registerData: any = { email, name };
      if (phone) registerData.phone = phone;
      // Role defaults to 'owner' on backend
      
      try {
        await axiosClient.post('/auth/register', registerData, {
          headers: { Authorization: `Bearer ${idToken}` }
        });
      } catch (backendError: any) {
        // 409 means user already exists in backend - this is OK
        if (backendError.response?.status === 409) {
          console.log('User already exists in backend, proceeding with login');
        } else {
          console.error('Backend registration error:', backendError);
          // If backend fails but Firebase succeeded, still sync user data
          // The backend might auto-create user on first login
        }
      }

      // 4. Refresh user data
      await syncUserWithBackend(userCredential.user);
      
    } catch (error: any) {
      console.error('Sign up error:', error);

      throw new Error(
        getFriendlyAuthErrorMessage(error, 'We could not create your account. Please try again.')
      );
    }
  };

  const signIn = async (credentials: { email: string; password: string; keepLoggedIn?: boolean }) => {
    try {
      const { email, password, keepLoggedIn: keepLogin = false } = credentials;
      
      // Save keepLoggedIn preference
      await AsyncStorage.setItem('keepLoggedIn', keepLogin.toString());
      setKeepLoggedIn(keepLogin);
      
      // 1. Sign in with Firebase
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      // 2. Sync with backend
      await syncUserWithBackend(userCredential.user, false, true);
      
      // 3. Setup token refresh if keepLoggedIn is enabled
      if (keepLogin) {
        setupTokenRefresh(userCredential.user);
        console.log('✅ Auto token refresh enabled - you will stay logged in');
      }
      
    } catch (error: any) {
      console.error('Sign in error:', error);
      const friendlyMessage = getFriendlyAuthErrorMessage(
        error,
        'We could not sign you in. Please try again.'
      );
      if (friendlyMessage.toLowerCase().includes('suspended')) {
        try {
          await firebaseSignOut(auth);
        } catch {}
        throw new Error(friendlyMessage);
      }

      throw new Error(friendlyMessage);
    }
  };

  const signOut = async () => {
    try {
      // Clear token refresh
      clearTokenRefresh();
      
      // Clear keepLoggedIn preference
      await AsyncStorage.removeItem('keepLoggedIn');
      setKeepLoggedIn(false);
      
      await firebaseSignOut(auth);
      setUser(null);
      setToken(null);
      (global as any).authToken = null;
      (global as any).firebaseUser = null;
      delete axiosClient.defaults.headers.common['Authorization'];
    } catch (error: any) {
      console.error('Sign out error:', error);
      throw new Error(error.message || 'Sign out failed');
    }
  };

  const resetPassword = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error: any) {
      console.error('Password reset error:', error);

      throw new Error(
        getFriendlyAuthErrorMessage(error, 'We could not send the reset email. Please try again.')
      );
    }
  };

  const updateProfile = async (data: Partial<User>) => {
    try {
      const response = await axiosClient.patch('/auth/me', data);
      // Update local user state with the response
      setUser(response.data);
      return response.data;
    } catch (error: any) {
      console.error('Update profile error:', error);
      throw new Error(
        getFriendlyAuthErrorMessage(error, 'We could not save your profile changes right now.')
      );
    }
  };

  const updateUser = (userData: User) => {
    setUser(userData);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      firebaseUser, 
      token, 
      loading,
      keepLoggedIn, 
      signIn, 
      signUp, 
      signOut, 
      resetPassword,
      updateProfile,
      updateUser
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export { auth };
