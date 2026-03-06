import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { FoundItem } from '../types/models';

interface ItemCardProps {
  item: FoundItem;
  onPress: () => void;
}

export const ItemCard: React.FC<ItemCardProps> = ({ item, onPress }) => {
  // Format location display - show first location
  const formatLocation = () => {
    if (!item.found_location || item.found_location.length === 0) return 'Location not specified';
    const loc = item.found_location[0];
    let locationStr = loc.location;
    if (loc.floor_id) locationStr += ` - Floor: ${loc.floor_id}`;
    if (loc.hall_name) locationStr += ` - ${loc.hall_name}`;
    return locationStr;
  };

  const getImageMatchStyle = (score: number) => {
    if (score >= 0.8) {
      return { backgroundColor: '#E4F4EA', color: '#1F7A3D' };
    }

    if (score >= 0.6) {
      return { backgroundColor: '#FFF4D6', color: '#9C6A00' };
    }

    return { backgroundColor: '#ECEFF3', color: '#667085' };
  };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <Image 
        source={{ uri: item.imageUrl }} 
        style={styles.image}
        resizeMode="cover"
      />
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.category}>{item.category}</Text>
          <View style={[styles.statusBadge, getStatusBadgeStyle(item.status)]}>
            <Text style={styles.statusText}>{item.status}</Text>
          </View>
        </View>
        <Text style={styles.description} numberOfLines={2}>
          {item.description}
        </Text>
        {item.imageMatch && (
          <View
            style={[
              styles.imageMatchBadge,
              { backgroundColor: getImageMatchStyle(item.imageMatch.score).backgroundColor },
            ]}
          >
            <Text
              style={[
                styles.imageMatchText,
                { color: getImageMatchStyle(item.imageMatch.score).color },
              ]}
            >
              {`${Math.round(item.imageMatch.score * 100)}% visual match`}
            </Text>
          </View>
        )}
        <View style={styles.footer}>
          <Text style={styles.location}>📍 {formatLocation()}</Text>
          <Text style={styles.date}>
            {new Date(item.createdAt).toLocaleDateString()}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const getStatusBadgeStyle = (status: string) => {
  switch (status) {
    case 'available':
      return { backgroundColor: '#4CAF50' };
    case 'pending_verification':
      return { backgroundColor: '#FF9800' };
    case 'claimed':
      return { backgroundColor: '#9E9E9E' };
    default:
      return { backgroundColor: '#757575' };
  }
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  image: {
    width: '100%',
    height: 200,
    backgroundColor: '#E0E0E0',
  },
  content: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  category: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    textTransform: 'capitalize',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  description: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 12,
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  imageMatchBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 12,
  },
  imageMatchText: {
    fontSize: 12,
    fontWeight: '700',
  },
  location: {
    fontSize: 13,
    color: '#4A90E2',
    fontWeight: '500',
  },
  date: {
    fontSize: 12,
    color: '#999999',
  },
});
