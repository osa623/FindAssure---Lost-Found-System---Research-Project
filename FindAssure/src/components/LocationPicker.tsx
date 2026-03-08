import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import axiosClient from '../api/axiosClient';
import {
  getFloorOptions,
  getHallOptions,
  getLocationOptions,
  hasFloors,
  LocationDetail,
} from '../constants/locationData';
import { useAppTheme } from '../context/ThemeContext';
import { GlassCard } from './GlassCard';

interface LocationPickerProps {
  selectedValue: LocationDetail | null;
  onValueChange: (value: LocationDetail) => void;
  allowDoNotRemember?: boolean;
  userType?: 'founder' | 'owner';
  label?: string;
  error?: string;
}

export const LocationPicker: React.FC<LocationPickerProps> = ({
  selectedValue,
  onValueChange,
  allowDoNotRemember = false,
  userType = 'founder',
  label = 'Location',
  error,
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [modalVisible, setModalVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState<'location' | 'floor' | 'hall'>('location');
  const [selectedLocation, setSelectedLocation] = useState<string>(selectedValue?.location || '');
  const [selectedFloor, setSelectedFloor] = useState<string | null>(selectedValue?.floor_id || null);
  const [selectedHall, setSelectedHall] = useState<string | null>(selectedValue?.hall_name || null);
  const [locationOptions, setLocationOptions] = useState<{ label: string; value: string }[]>([]);
  const [floorOptions, setFloorOptions] = useState<{ label: string; value: string }[]>([]);
  const [hallOptions, setHallOptions] = useState<{ label: string; value: string }[]>([]);
  const [locationsWithFloors, setLocationsWithFloors] = useState<Set<string>>(new Set());
  const [loadingOptions, setLoadingOptions] = useState(false);
  const translateY = useSharedValue(40);

  useEffect(() => {
    translateY.value = modalVisible ? withSpring(0, theme.motion.spring) : 40;
  }, [modalVisible, theme.motion.spring, translateY]);

  const animatedSheet = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const locationHasFloors = useCallback(
    (location: string): boolean => locationsWithFloors.has(location) || hasFloors(location),
    [locationsWithFloors]
  );

  const loadLocations = useCallback(async () => {
    setLoadingOptions(true);
    try {
      const response = await axiosClient.get('/locations/main');
      const items = response.data?.data;
      if (Array.isArray(items) && items.length > 0) {
        setLocationOptions(items.map((item: any) => ({ label: item.label, value: item.value })));
        setLocationsWithFloors(new Set(items.filter((item: any) => Boolean(item.hasFloors)).map((item: any) => item.value)));
      } else {
        setLocationOptions(getLocationOptions());
      }
    } catch {
      setLocationOptions(getLocationOptions());
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  const loadFloors = useCallback(async (location: string) => {
    if (!locationHasFloors(location)) {
      setFloorOptions([]);
      return;
    }
    try {
      const response = await axiosClient.get(`/locations/${encodeURIComponent(location)}/floors`);
      const items = response.data?.data;
      setFloorOptions(Array.isArray(items) && items.length > 0 ? items.map((item: any) => ({ label: item.label, value: item.value })) : getFloorOptions(location));
    } catch {
      setFloorOptions(getFloorOptions(location));
    }
  }, [locationHasFloors]);

  const loadHalls = useCallback(async (location: string, floorId: string) => {
    try {
      const response = await axiosClient.get(
        `/locations/${encodeURIComponent(location)}/floors/${encodeURIComponent(floorId)}/halls`
      );
      const items = response.data?.data;
      setHallOptions(Array.isArray(items) && items.length > 0 ? items.map((item: any) => ({ label: item.label, value: item.value })) : getHallOptions(location, floorId));
    } catch {
      setHallOptions(getHallOptions(location, floorId));
    }
  }, []);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  useEffect(() => {
    if (selectedLocation) {
      loadFloors(selectedLocation);
    } else {
      setFloorOptions([]);
    }
    setHallOptions([]);
  }, [selectedLocation, loadFloors]);

  useEffect(() => {
    if (selectedLocation && selectedFloor) {
      loadHalls(selectedLocation, selectedFloor);
    } else {
      setHallOptions([]);
    }
  }, [selectedLocation, selectedFloor, loadHalls]);

  const handleLocationSelect = (value: string) => {
    setSelectedLocation(value);
    if (locationHasFloors(value)) {
      setCurrentStep('floor');
      setSelectedFloor(null);
      setSelectedHall(null);
      return;
    }
    onValueChange({ location: value, floor_id: null, hall_name: null });
    setModalVisible(false);
    setCurrentStep('location');
  };

  const handleFloorSelect = (value: string) => {
    if (value === 'do_not_remember') {
      onValueChange({ location: selectedLocation, floor_id: null, hall_name: null });
      setModalVisible(false);
      setCurrentStep('location');
      setSelectedFloor(null);
      setSelectedHall(null);
      return;
    }
    setSelectedFloor(value);
    setCurrentStep('hall');
    setSelectedHall(null);
  };

  const handleHallSelect = (value: string) => {
    const hallName = value === 'do_not_remember' ? null : value;
    setSelectedHall(hallName);
    onValueChange({
      location: selectedLocation,
      floor_id: selectedFloor,
      hall_name: hallName,
    });
    setModalVisible(false);
    setCurrentStep('location');
  };

  const handleOptionSelect = (value: string) => {
    if (currentStep === 'location') handleLocationSelect(value);
    if (currentStep === 'floor') handleFloorSelect(value);
    if (currentStep === 'hall') handleHallSelect(value);
  };

  const handleBack = () => {
    if (currentStep === 'hall') {
      setCurrentStep('floor');
      return;
    }
    if (currentStep === 'floor') {
      setCurrentStep('location');
    }
  };

  const handleModalClose = () => {
    setModalVisible(false);
    setCurrentStep('location');
  };

  const formatLabel = (value: string) =>
    value
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

  const getDisplayContent = () => {
    if (!selectedValue?.location) {
      return {
        title: 'Select location',
        subtitle: userType === 'owner' ? 'Location, floor, and hall if you remember them' : 'Location, floor, and hall',
      };
    }

    const parts: string[] = [];
    if (selectedValue.floor_id) parts.push(`Floor ${selectedValue.floor_id}`);
    if (selectedValue.hall_name) parts.push(formatLabel(selectedValue.hall_name));

    return {
      title: formatLabel(selectedValue.location),
      subtitle: parts.join(' · '),
    };
  };

  const getModalTitle = () => {
    if (currentStep === 'location') return 'Choose location';
    if (currentStep === 'floor') return 'Choose floor';
    return 'Choose hall';
  };

  const getContextText = () => {
    if (currentStep === 'floor' && selectedLocation) {
      return formatLabel(selectedLocation);
    }
    if (currentStep === 'hall' && selectedLocation) {
      const parts = [formatLabel(selectedLocation)];
      if (selectedFloor) parts.push(`Floor ${selectedFloor}`);
      return parts.join(' · ');
    }
    return '';
  };

  const getCurrentOptions = () => {
    if (currentStep === 'location') return locationOptions;
    if (currentStep === 'floor') {
      return userType === 'owner' && allowDoNotRemember
        ? [{ label: 'Do Not Remember', value: 'do_not_remember' }, ...floorOptions]
        : floorOptions;
    }
    return userType === 'owner' && allowDoNotRemember
      ? [{ label: 'Do Not Remember', value: 'do_not_remember' }, ...hallOptions]
      : hallOptions;
  };

  const display = getDisplayContent();
  const sheetMaxHeight = Math.round(Dimensions.get('window').height * 0.74);

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <Pressable style={[styles.trigger, error ? styles.triggerError : null]} onPress={() => setModalVisible(true)}>
        <View style={styles.triggerCopy}>
          <Text numberOfLines={1} style={styles.triggerTitle}>
            {display.title}
          </Text>
          {display.subtitle ? <Text numberOfLines={1} style={styles.triggerCaption}>{display.subtitle}</Text> : null}
        </View>
        <View style={styles.triggerIconWrap}>
          <Ionicons name="chevron-down" size={18} color={theme.colors.textSubtle} />
        </View>
      </Pressable>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleModalClose}
      >
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleModalClose} />
          <Animated.View style={[styles.sheetWrap, animatedSheet]}>
            <GlassCard style={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
              <View style={styles.sheetHeader}>
                <View style={styles.headerCopy}>
                  <Text style={styles.eyebrow}>{currentStep.toUpperCase()}</Text>
                  <Text style={styles.sheetTitle}>{getModalTitle()}</Text>
                  {getContextText() ? <Text style={styles.contextText}>{getContextText()}</Text> : null}
                </View>
                <View style={styles.headerActions}>
                  {currentStep !== 'location' ? (
                    <Pressable style={styles.smallButton} onPress={handleBack}>
                      <Ionicons name="chevron-back" size={16} color={theme.colors.textStrong} />
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.smallButton} onPress={handleModalClose}>
                    <Ionicons name="close" size={18} color={theme.colors.textStrong} />
                  </Pressable>
                </View>
              </View>

              <FlatList
                data={getCurrentOptions()}
                keyExtractor={(item) => item.value}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.options}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    {loadingOptions ? (
                      <>
                        <ActivityIndicator size="small" color={theme.colors.accent} />
                        <Text style={styles.emptyText}>Loading locations…</Text>
                      </>
                    ) : (
                      <Text style={styles.emptyText}>No options available</Text>
                    )}
                  </View>
                }
                renderItem={({ item }) => {
                  const selected =
                    (currentStep === 'location' && item.value === selectedLocation) ||
                    (currentStep === 'floor' && item.value === selectedFloor) ||
                    (currentStep === 'hall' && item.value === selectedHall);

                  return (
                    <Pressable
                      style={[styles.option, selected && styles.optionSelected]}
                      onPress={() => handleOptionSelect(item.value)}
                    >
                      <View style={styles.optionCopy}>
                        <Text numberOfLines={1} style={[styles.optionText, selected && styles.optionTextSelected]}>
                          {item.label}
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
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      marginBottom: theme.spacing.md,
    },
    label: {
      ...theme.type.label,
      marginBottom: theme.spacing.sm,
    },
    trigger: {
      minHeight: 56,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      backgroundColor: theme.colors.input,
      paddingHorizontal: theme.spacing.md,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    triggerError: {
      borderColor: theme.colors.danger,
    },
    triggerCopy: {
      flex: 1,
      minWidth: 0,
      marginRight: theme.spacing.sm,
    },
    triggerTitle: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
    },
    triggerCaption: {
      ...theme.type.caption,
      marginTop: 2,
      color: theme.colors.textMuted,
    },
    triggerIconWrap: {
      width: 18,
      alignItems: 'flex-end',
    },
    errorText: {
      ...theme.type.caption,
      color: theme.colors.danger,
      marginTop: theme.spacing.xs,
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
      alignItems: 'center',
      marginBottom: theme.spacing.lg,
    },
    headerCopy: {
      flex: 1,
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
    contextText: {
      ...theme.type.caption,
      marginTop: 4,
      color: theme.colors.textMuted,
    },
    headerActions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    smallButton: {
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
      minHeight: 50,
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
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.xl,
    },
    emptyText: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginTop: theme.spacing.sm,
    },
  });
