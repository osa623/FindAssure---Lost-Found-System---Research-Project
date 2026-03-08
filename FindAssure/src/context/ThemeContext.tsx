import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { AppTheme, createAppTheme, ThemePreference } from '../theme/designSystem';

interface ThemeContextValue {
  theme: AppTheme;
  preference: ThemePreference;
  resolvedMode: 'light' | 'dark';
  isDark: boolean;
  setThemePreference: (next: ThemePreference) => Promise<void>;
}

const STORAGE_KEY = 'findassure.themePreference';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    const loadPreference = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreference(stored);
        }
      } catch (error) {
        console.error('Failed to load theme preference:', error);
      }
    };

    loadPreference();
  }, []);

  const resolvedMode = useMemo<'light' | 'dark'>(() => {
    if (preference === 'system') {
      return systemScheme === 'dark' ? 'dark' : 'light';
    }

    return preference;
  }, [preference, systemScheme]);

  const theme = useMemo(() => createAppTheme(resolvedMode), [resolvedMode]);

  useEffect(() => {
    try {
      if (typeof Appearance.setColorScheme === 'function') {
        Appearance.setColorScheme(preference === 'system' ? null : preference);
      }
    } catch {
      // ignore platform implementations that do not support manual overrides
    }

    SystemUI.setBackgroundColorAsync(theme.colors.background).catch(() => {
      // ignore failures in unsupported environments
    });
  }, [preference, theme.colors.background]);

  const setThemePreference = async (next: ThemePreference) => {
    setPreference(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
    } catch (error) {
      console.error('Failed to persist theme preference:', error);
    }
  };

  const value = useMemo(
    () => ({
      theme,
      preference,
      resolvedMode,
      isDark: resolvedMode === 'dark',
      setThemePreference,
    }),
    [theme, preference, resolvedMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useAppTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useAppTheme must be used within ThemeProvider');
  }

  return context;
};
