import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { ITEM_CATEGORIES } from '../constants/appConstants';
import { useAppTheme } from '../context/ThemeContext';
import { GlassCard } from './GlassCard';

interface CategoryPickerProps {
  selectedValue: string;
  onValueChange: (value: string) => void;
}

export const CategoryPicker: React.FC<CategoryPickerProps> = ({
  selectedValue,
  onValueChange,
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [modalVisible, setModalVisible] = useState(false);
  const translateY = useSharedValue(40);

  useEffect(() => {
    translateY.value = modalVisible ? withSpring(0, theme.motion.spring) : 40;
  }, [modalVisible, theme.motion.spring, translateY]);

  const animatedSheet = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const selectedLabel = useMemo(() => selectedValue || 'Select category', [selectedValue]);
  const sheetMaxHeight = Math.round(Dimensions.get('window').height * 0.72);

  const handleSelect = (value: string) => {
    onValueChange(value);
    setModalVisible(false);
  };

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setModalVisible(true)}>
        <View style={styles.triggerCopy}>
          <Text numberOfLines={1} style={styles.triggerTitle}>
            {selectedLabel}
          </Text>
          <Text numberOfLines={1} style={styles.triggerCaption}>
            Choose the closest item type for search and reporting.
          </Text>
        </View>
        <View style={styles.triggerIconWrap}>
          <Ionicons name="chevron-down" size={18} color={theme.colors.textSubtle} />
        </View>
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
            <GlassCard style={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
              <View style={styles.sheetHeader}>
                <View style={styles.headerCopy}>
                  <Text style={styles.eyebrow}>Category</Text>
                  <Text style={styles.sheetTitle}>Choose item category</Text>
                  <Text style={styles.headerCaption}>
                    Pick the closest fit. You can describe specifics in the next field.
                  </Text>
                </View>
                <Pressable style={styles.closeButton} onPress={() => setModalVisible(false)}>
                  <Ionicons name="close" size={18} color={theme.colors.textStrong} />
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
                        <Text numberOfLines={1} style={[styles.optionText, selected && styles.optionTextSelected]}>
                          {item}
                        </Text>
                      </View>
                      <View style={styles.optionIconWrap}>
                        {selected ? (
                          <View style={styles.checkBadge}>
                            <Ionicons name="checkmark" size={14} color={theme.colors.inverse} />
                          </View>
                        ) : (
                          <Ionicons name="chevron-forward" size={16} color={theme.colors.textSubtle} />
                        )}
                      </View>
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

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    trigger: {
      minHeight: 56,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      backgroundColor: theme.colors.input,
      paddingHorizontal: theme.spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    triggerCopy: {
      flex: 1,
      minWidth: 0,
      marginRight: theme.spacing.sm,
    },
    triggerTitle: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      textTransform: 'capitalize',
    },
    triggerCaption: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      marginTop: 2,
    },
    triggerIconWrap: {
      width: 18,
      alignItems: 'flex-end',
    },
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: theme.colors.overlay,
    },
    sheetWrap: {
      paddingHorizontal: theme.spacing.md,
      paddingBottom: 16,
    },
    sheet: {
      borderRadius: theme.radius.xl,
    },
    sheetHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: theme.spacing.lg,
    },
    headerCopy: {
      flex: 1,
      minWidth: 0,
      marginRight: theme.spacing.md,
    },
    eyebrow: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    sheetTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
    },
    headerCaption: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      marginTop: 4,
    },
    closeButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.cardMuted,
    },
    options: {
      gap: theme.spacing.sm,
    },
    option: {
      minHeight: 48,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 10,
      backgroundColor: theme.colors.input,
      borderWidth: 1,
      borderColor: theme.colors.border,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    optionSelected: {
      backgroundColor: theme.colors.accentSoft,
      borderColor: theme.colors.accent,
    },
    optionCopy: {
      flex: 1,
      minWidth: 0,
      marginRight: theme.spacing.md,
    },
    optionText: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      textTransform: 'capitalize',
    },
    optionTextSelected: {
      color: theme.colors.accent,
    },
    optionIconWrap: {
      width: 24,
      alignItems: 'flex-end',
    },
    checkBadge: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: theme.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
