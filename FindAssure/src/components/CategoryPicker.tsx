import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { ITEM_CATEGORIES } from '../constants/appConstants';
import { GlassCard } from './GlassCard';
import { motion, palette, radius, spacing, type } from '../theme/designSystem';

interface CategoryPickerProps {
  selectedValue: string;
  onValueChange: (value: string) => void;
}

export const CategoryPicker: React.FC<CategoryPickerProps> = ({
  selectedValue,
  onValueChange,
}) => {
  const [modalVisible, setModalVisible] = useState(false);
  const translateY = useSharedValue(40);

  useEffect(() => {
    translateY.value = modalVisible ? withSpring(0, motion.spring) : 40;
  }, [modalVisible, translateY]);

  const animatedSheet = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const selectedLabel = useMemo(() => selectedValue || 'Select category', [selectedValue]);

  const handleSelect = (value: string) => {
    onValueChange(value);
    setModalVisible(false);
  };

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setModalVisible(true)}>
        <Text numberOfLines={1} style={styles.triggerText}>{selectedLabel}</Text>
        <Ionicons name="chevron-down" size={18} color={palette.mist} />
      </Pressable>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setModalVisible(false)} />
          <Animated.View style={[styles.sheetWrap, animatedSheet]}>
            <GlassCard style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <View>
                  <Text style={styles.eyebrow}>Browse</Text>
                  <Text style={styles.sheetTitle}>Item Category</Text>
                </View>
                <Pressable style={styles.closeButton} onPress={() => setModalVisible(false)}>
                  <Ionicons name="close" size={18} color={palette.ink} />
                </Pressable>
              </View>

              <FlatList
                data={ITEM_CATEGORIES}
                keyExtractor={(item) => item}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.options}
                renderItem={({ item }) => {
                  const selected = item === selectedValue;
                  return (
                    <Pressable
                      style={[styles.option, selected && styles.optionSelected]}
                      onPress={() => handleSelect(item)}
                    >
                      <View style={styles.optionCopy}>
                        <Text numberOfLines={1} style={[styles.optionText, selected && styles.optionTextSelected]}>{item}</Text>
                      </View>
                      {selected ? (
                        <View style={styles.checkBadge}>
                          <Ionicons name="checkmark" size={14} color={palette.paperStrong} />
                        </View>
                      ) : (
                        <Ionicons name="chevron-forward" size={16} color={palette.mist} />
                      )}
                    </Pressable>
                  );
                }}
              />
            </GlassCard>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  trigger: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.paperStrong,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  triggerText: {
    ...type.bodyStrong,
    flex: 1,
    minWidth: 0,
    marginRight: spacing.sm,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.16)',
  },
  sheetWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: 16,
  },
  sheet: {
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  eyebrow: {
    ...type.label,
    marginBottom: spacing.xs,
  },
  sheetTitle: {
    ...type.section,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.paper,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: palette.paperStrong,
    borderWidth: 1,
    borderColor: palette.line,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionSelected: {
    backgroundColor: palette.primarySoft,
    borderColor: 'rgba(79,124,255,0.2)',
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.md,
  },
  optionText: {
    ...type.bodyStrong,
    textTransform: 'capitalize',
  },
  optionTextSelected: {
    color: palette.primaryDeep,
  },
  checkBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
