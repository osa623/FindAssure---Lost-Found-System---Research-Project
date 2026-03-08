import React from 'react';
import { Text, StyleSheet, View, Pressable } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { GlassCard } from './GlassCard';
import { motion, palette, radius, spacing, type } from '../theme/designSystem';

interface QuestionChipProps {
  question: string;
  selected: boolean;
  onPress: () => void;
}

export const QuestionChip: React.FC<QuestionChipProps> = ({
  question,
  selected,
  onPress,
}) => {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          scale.value = withSpring(0.985, motion.springSoft);
        }}
        onPressOut={() => {
          scale.value = withSpring(1, motion.spring);
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

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.md,
    marginBottom: 10,
  },
  chipSelected: {
    borderColor: 'rgba(79,124,255,0.22)',
    backgroundColor: '#F6F9FF',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: palette.line,
    backgroundColor: palette.paperStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },
  checkmark: {
    color: palette.paperStrong,
    fontSize: 13,
    fontWeight: '900',
  },
  chipText: {
    flex: 1,
    ...type.body,
  },
  chipTextSelected: {
    color: palette.ink,
    fontWeight: '700',
  },
});
