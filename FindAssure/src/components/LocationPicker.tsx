import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  Platform,
  ActivityIndicator,
} from 'react-native';
import axiosClient from '../api/axiosClient';
import {
  getLocationOptions,
  getFloorOptions,
  getHallOptions,
  hasFloors,
  LocationDetail,
} from '../constants/locationData';

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
  const [modalVisible, setModalVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState<'location' | 'floor' | 'hall'>('location');
  
  const [selectedLocation, setSelectedLocation] = useState<string>(selectedValue?.location || '');
  const [selectedFloor, setSelectedFloor] = useState<string | null>(selectedValue?.floor_id || null);
  const [selectedHall, setSelectedHall] = useState<string | null>(selectedValue?.hall_name || null);
  const [locationOptions, setLocationOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [floorOptions, setFloorOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [hallOptions, setHallOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [locationsWithFloors, setLocationsWithFloors] = useState<Set<string>>(new Set());
  const [loadingOptions, setLoadingOptions] = useState(false);

  const locationHasFloors = (location: string): boolean => {
    return locationsWithFloors.has(location) || hasFloors(location);
  };

  const loadLocations = async () => {
    setLoadingOptions(true);
    try {
      const response = await axiosClient.get('/locations/main');
      const items = response.data?.data;
      if (Array.isArray(items) && items.length > 0) {
        setLocationOptions(
          items.map((item: any) => ({
            label: item.label,
            value: item.value,
          }))
        );
        setLocationsWithFloors(
          new Set(
            items
              .filter((item: any) => Boolean(item.hasFloors))
              .map((item: any) => item.value)
          )
        );
      } else {
        setLocationOptions(getLocationOptions());
      }
    } catch (error) {
      console.warn('Failed to fetch locations from backend, using local fallback');
      setLocationOptions(getLocationOptions());
    } finally {
      setLoadingOptions(false);
    }
  };

  const loadFloors = async (location: string) => {
    if (!locationHasFloors(location)) {
      setFloorOptions([]);
      return;
    }

    try {
      const response = await axiosClient.get(
        `/locations/${encodeURIComponent(location)}/floors`
      );
      const items = response.data?.data;
      if (Array.isArray(items) && items.length > 0) {
        setFloorOptions(
          items.map((item: any) => ({
            label: item.label,
            value: item.value,
          }))
        );
      } else {
        setFloorOptions(getFloorOptions(location));
      }
    } catch (error) {
      console.warn('Failed to fetch floors from backend, using local fallback');
      setFloorOptions(getFloorOptions(location));
    }
  };

  const loadHalls = async (location: string, floorId: string) => {
    try {
      const response = await axiosClient.get(
        `/locations/${encodeURIComponent(location)}/floors/${encodeURIComponent(floorId)}/halls`
      );
      const items = response.data?.data;
      if (Array.isArray(items) && items.length > 0) {
        setHallOptions(
          items.map((item: any) => ({
            label: item.label,
            value: item.value,
          }))
        );
      } else {
        setHallOptions(getHallOptions(location, floorId));
      }
    } catch (error) {
      console.warn('Failed to fetch halls from backend, using local fallback');
      setHallOptions(getHallOptions(location, floorId));
    }
  };

  useEffect(() => {
    loadLocations();
  }, []);

  useEffect(() => {
    if (selectedLocation) {
      loadFloors(selectedLocation);
    } else {
      setFloorOptions([]);
    }
    setHallOptions([]);
  }, [selectedLocation]);

  useEffect(() => {
    if (selectedLocation && selectedFloor) {
      loadHalls(selectedLocation, selectedFloor);
    } else {
      setHallOptions([]);
    }
  }, [selectedLocation, selectedFloor]);

  const handleLocationSelect = (value: string) => {
    setSelectedLocation(value);
    
    if (locationHasFloors(value)) {
      setCurrentStep('floor');
      setSelectedFloor(null);
      setSelectedHall(null);
    } else {
      // No floors, complete selection
      onValueChange({
        location: value,
        floor_id: null,
        hall_name: null,
      });
      setModalVisible(false);
      setCurrentStep('location');
    }
  };

  const handleFloorSelect = (value: string) => {
    if (value === 'do_not_remember') {
      // Owner can choose not to remember
      onValueChange({
        location: selectedLocation,
        floor_id: null,
        hall_name: null,
      });
      setModalVisible(false);
      setCurrentStep('location');
      setSelectedFloor(null);
      setSelectedHall(null);
    } else {
      setSelectedFloor(value);
      // Both founder and owner should see hall selection
      setCurrentStep('hall');
      setSelectedHall(null);
    }
  };

  const handleHallSelect = (value: string) => {
    if (value === 'do_not_remember') {
      // Owner can choose not to remember hall
      setSelectedHall(null);
      onValueChange({
        location: selectedLocation,
        floor_id: selectedFloor,
        hall_name: null,
      });
    } else {
      setSelectedHall(value);
      onValueChange({
        location: selectedLocation,
        floor_id: selectedFloor,
        hall_name: value,
      });
    }
    setModalVisible(false);
    setCurrentStep('location');
  };

  const handleBack = () => {
    if (currentStep === 'hall') {
      setCurrentStep('floor');
      setSelectedHall(null);
    } else if (currentStep === 'floor') {
      setCurrentStep('location');
      setSelectedFloor(null);
      setSelectedHall(null);
    }
  };

  const handleModalClose = () => {
    setModalVisible(false);
    setCurrentStep('location');
  };

  const getDisplayText = () => {
    if (!selectedValue || !selectedValue.location) {
      return 'Select Location';
    }

    let text = selectedValue.location.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');

    if (selectedValue.floor_id) {
      text += ` - Floor ${selectedValue.floor_id}`;
    }

    if (selectedValue.hall_name) {
      text += ` - ${selectedValue.hall_name.split('_').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ')}`;
    }

    return text;
  };

  const getModalTitle = () => {
    switch (currentStep) {
      case 'location':
        return 'Select Location';
      case 'floor':
        return 'Select Floor';
      case 'hall':
        return 'Select Hall';
      default:
        return 'Select Location';
    }
  };

  const getCurrentOptions = () => {
    switch (currentStep) {
      case 'location':
        return locationOptions;
      case 'floor':
        const options = floorOptions;
        if (userType === 'owner' && allowDoNotRemember) {
          return [{ label: 'Do Not Remember', value: 'do_not_remember' }, ...options];
        }
        return options;
      case 'hall':
        const hallOpts = hallOptions;
        if (userType === 'owner' && allowDoNotRemember) {
          return [{ label: 'Do Not Remember', value: 'do_not_remember' }, ...hallOpts];
        }
        return hallOpts;
      default:
        return [];
    }
  };

  const handleOptionSelect = (value: string) => {
    switch (currentStep) {
      case 'location':
        handleLocationSelect(value);
        break;
      case 'floor':
        handleFloorSelect(value);
        break;
      case 'hall':
        handleHallSelect(value);
        break;
    }
  };

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      
      <TouchableOpacity
        style={[styles.pickerButton, error ? styles.pickerButtonError : null]}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.pickerButtonText}>{getDisplayText()}</Text>
        <Text style={styles.pickerIcon}>▼</Text>
      </TouchableOpacity>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={handleModalClose}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              {currentStep !== 'location' && (
                <TouchableOpacity
                  onPress={handleBack}
                  style={styles.backButton}
                >
                  <Text style={styles.backButtonText}>← Back</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalTitle}>{getModalTitle()}</Text>
              <TouchableOpacity
                onPress={handleModalClose}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={getCurrentOptions()}
              keyExtractor={(item) => item.value}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  {loadingOptions ? (
                    <>
                      <ActivityIndicator size="small" color="#1565C0" />
                      <Text style={styles.emptyText}>Loading locations...</Text>
                    </>
                  ) : (
                    <Text style={styles.emptyText}>No options available</Text>
                  )}
                </View>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.optionItem}
                  onPress={() => handleOptionSelect(item.value)}
                >
                  <Text style={styles.optionText}>
                    {item.label}
                  </Text>
                  <Text style={styles.optionIcon}>→</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 8,
  },
  pickerButton: {
    borderWidth: 1,
    borderColor: '#DDDDDD',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#FAFAFA',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 50,
  },
  pickerButtonError: {
    borderColor: '#D32F2F',
  },
  pickerButtonText: {
    fontSize: 16,
    color: '#333333',
    flex: 1,
  },
  pickerIcon: {
    fontSize: 12,
    color: '#666666',
  },
  errorText: {
    fontSize: 14,
    color: '#D32F2F',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333333',
    flex: 1,
    textAlign: 'center',
  },
  backButton: {
    padding: 5,
    marginRight: 10,
  },
  backButtonText: {
    fontSize: 16,
    color: '#1565C0',
    fontWeight: '500',
  },
  closeButton: {
    padding: 5,
  },
  closeButtonText: {
    fontSize: 24,
    color: '#666666',
    fontWeight: '300',
  },
  optionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  optionText: {
    fontSize: 16,
    color: '#333333',
    flex: 1,
  },
  optionIcon: {
    fontSize: 16,
    color: '#666666',
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    marginTop: 8,
    fontSize: 14,
    color: '#666666',
  },
});
