import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  actionLabel?: string;
  onAction?: () => void;
  dedupeKey?: string;
}

interface ToastItem extends Required<Pick<ToastOptions, 'title' | 'variant' | 'duration'>> {
  id: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  dedupeKey: string;
}

interface ToastContextValue {
  showToast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const getDefaultDuration = (variant: ToastVariant) => {
  switch (variant) {
    case 'success':
      return 2200;
    case 'warning':
      return 3400;
    case 'error':
      return 5200;
    default:
      return 2800;
  }
};

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
  const toastsRef = useRef<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    toastsRef.current = toastsRef.current.filter((toast) => toast.id !== id);
    const timer = timersRef.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timersRef.current[id];
    }
  }, []);

  useEffect(
    () => () => {
      Object.values(timersRef.current).forEach((timer) => clearTimeout(timer));
      timersRef.current = {};
      toastsRef.current = [];
    },
    []
  );

  const showToast = useCallback(
    (options: ToastOptions) => {
      const variant = options.variant ?? 'info';
      const duration = options.duration ?? getDefaultDuration(variant);
      const dedupeKey = options.dedupeKey ?? `${variant}:${options.title}:${options.message ?? ''}`;
      const existingToast = toastsRef.current.find((toast) => toast.dedupeKey === dedupeKey);

      if (existingToast) {
        const activeTimer = timersRef.current[existingToast.id];
        if (activeTimer) {
          clearTimeout(activeTimer);
        }
        timersRef.current[existingToast.id] = setTimeout(() => dismissToast(existingToast.id), duration);
        return;
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toast: ToastItem = {
        id,
        title: options.title,
        message: options.message,
        variant,
        duration,
        actionLabel: options.actionLabel,
        onAction: options.onAction,
        dedupeKey,
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

      setToasts((current) => {
        const next = [...current.filter((item) => item.variant === 'error'), toast].slice(-2);
        current
          .filter((item) => !next.some((nextItem) => nextItem.id === item.id))
          .forEach((item) => {
            const timer = timersRef.current[item.id];
            if (timer) {
              clearTimeout(timer);
              delete timersRef.current[item.id];
            }
          });
        toastsRef.current = next;
        return next;
      });
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
              <Pressable onPress={() => dismissToast(toast.id)} style={[styles.toast, { borderColor: accentSoft, backgroundColor: theme.colors.glassStrong }]}>
                <View style={[styles.accentBar, { backgroundColor: accent }]} />
                <View style={styles.contentRow}>
                  <View style={[styles.iconWrap, { backgroundColor: accentSoft }]}>
                    <Ionicons name={getVariantIcon(toast.variant)} size={18} color={accent} />
                  </View>
                  <View style={styles.copy}>
                    <Text style={styles.title}>{toast.title}</Text>
                    {toast.message ? <Text style={styles.message}>{toast.message}</Text> : null}
                    {toast.actionLabel && toast.onAction ? (
                      <Pressable
                        onPress={() => {
                          toast.onAction?.();
                          dismissToast(toast.id);
                        }}
                        style={[styles.actionButton, { backgroundColor: accentSoft }]}
                      >
                        <Text style={[styles.actionText, { color: accent }]}>{toast.actionLabel}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Ionicons name="close" size={16} color={theme.colors.textSubtle} style={styles.closeIcon} />
                </View>
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
      overflow: 'hidden',
      borderRadius: 22,
      borderWidth: 1,
      shadowColor: theme.colors.shadow,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: theme.isDark ? 0.3 : 0.08,
      shadowRadius: 20,
      elevation: 6,
    },
    accentBar: {
      height: 3,
      width: '100%',
    },
    contentRow: {
      paddingHorizontal: 14,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'flex-start',
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
    actionButton: {
      alignSelf: 'flex-start',
      marginTop: theme.spacing.sm,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 7,
    },
    actionText: {
      ...theme.type.caption,
      fontWeight: '700',
    },
    closeIcon: {
      marginTop: 8,
    },
  });

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }

  return context;
};
