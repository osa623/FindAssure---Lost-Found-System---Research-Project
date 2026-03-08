import React, { useMemo } from 'react';
import { Text, StyleSheet, View, Pressable } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { GlassCard } from './GlassCard';
import { useAppTheme } from '../context/ThemeContext';

interface QuestionChipProps {
  question: string;
  selected: boolean;
  onPress: () => void;
}

export const QuestionChip: React.FC<QuestionChipProps> = ({ question, selected, onPress }) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          scale.value = withSpring(0.985, theme.motion.springSoft);
        }}
        onPressOut={() => {
          scale.value = withSpring(1, theme.motion.spring);
        }}
      >
        <GlassCard style={[styles.chip, selected && styles.chipSelected]}>
          <View style={styles.row}>
            <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
              {selected ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{question}</Text>
          </View>
        </GlassCard>
      </Pressable>
    </Animated.View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    chip: {
      borderRadius: theme.radius.md,
      marginBottom: 10,
    },
    chipSelected: {
      borderColor: theme.colors.borderStrong,
      backgroundColor: theme.colors.accentSoft,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxSelected: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    checkmark: {
      color: theme.colors.onTint,
      fontSize: 13,
      fontWeight: '900',
    },
    chipText: {
      flex: 1,
      ...theme.type.body,
      color: theme.colors.textStrong,
    },
    chipTextSelected: {
      color: theme.colors.textStrong,
      fontWeight: '700',
    },
  });
