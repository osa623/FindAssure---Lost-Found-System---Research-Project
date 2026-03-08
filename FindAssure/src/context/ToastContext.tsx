import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from './ThemeContext';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  title: string;
  message?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, 'title' | 'variant' | 'duration'>> {
  id: string;
  message?: string;
}

interface ToastContextValue {
  showToast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const getVariantIcon = (variant: ToastVariant): keyof typeof Ionicons.glyphMap => {
  switch (variant) {
    case 'success':
      return 'checkmark-circle';
    case 'error':
      return 'alert-circle';
    case 'warning':
      return 'warning';
    default:
      return 'information-circle';
  }
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timersRef.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timersRef.current[id];
    }
  }, []);

  const showToast = useCallback(
    (options: ToastOptions) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toast: ToastItem = {
        id,
        title: options.title,
        message: options.message,
        variant: options.variant ?? 'info',
        duration: options.duration ?? 2600,
      };

      if (toast.variant === 'success') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      } else if (toast.variant === 'error') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      } else if (toast.variant === 'warning') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      }

      setToasts((current) => [...current.filter((item) => item.variant === 'error'), toast].slice(-2));
      timersRef.current[id] = setTimeout(() => dismissToast(id), toast.duration);
    },
    [dismissToast]
  );

  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 8 }]}>
        {toasts.map((toast) => {
          const accent =
            toast.variant === 'success'
              ? theme.colors.success
              : toast.variant === 'error'
                ? theme.colors.danger
                : toast.variant === 'warning'
                  ? theme.colors.warning
                  : theme.colors.accent;

          const accentSoft =
            toast.variant === 'success'
              ? theme.colors.successSoft
              : toast.variant === 'error'
                ? theme.colors.dangerSoft
                : toast.variant === 'warning'
                  ? theme.colors.warningSoft
                  : theme.colors.accentSoft;

          return (
            <Animated.View
              key={toast.id}
              entering={FadeInDown.duration(220)}
              exiting={FadeOutUp.duration(180)}
              style={styles.toastWrap}
            >
              <Pressable
                onPress={() => dismissToast(toast.id)}
                style={[styles.toast, { borderColor: accentSoft, backgroundColor: theme.colors.card }]}
              >
                <View style={[styles.iconWrap, { backgroundColor: accentSoft }]}>
                  <Ionicons name={getVariantIcon(toast.variant)} size={18} color={accent} />
                </View>
                <View style={styles.copy}>
                  <Text style={styles.title}>{toast.title}</Text>
                  {toast.message ? <Text style={styles.message}>{toast.message}</Text> : null}
                </View>
                <Ionicons name="close" size={16} color={theme.colors.textSubtle} />
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
    </ToastContext.Provider>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    host: {
      position: 'absolute',
      left: 0,
      right: 0,
      zIndex: 1000,
      paddingHorizontal: 16,
      pointerEvents: 'box-none',
    },
    toastWrap: {
      marginBottom: 10,
    },
    toast: {
      borderRadius: 22,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'flex-start',
      shadowColor: theme.colors.shadow,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: theme.isDark ? 0.3 : 0.08,
      shadowRadius: 20,
      elevation: 6,
    },
    iconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    copy: {
      flex: 1,
      minWidth: 0,
      marginRight: 10,
    },
    title: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      marginBottom: 2,
    },
    message: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
    },
  });

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }

  return context;
};
