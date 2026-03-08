import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { FoundItem } from '../types/models';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { GlassCard } from './GlassCard';
import { motion, palette, radius, spacing, type } from '../theme/designSystem';

interface ItemCardProps {
  item: FoundItem;
  onPress: () => void;
}

export const ItemCard: React.FC<ItemCardProps> = ({ item, onPress }) => {
  const scale = useSharedValue(1);

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
        <GlassCard style={styles.card} contentStyle={styles.cardContent}>
          <Image source={{ uri: item.imageUrl }} style={styles.image} contentFit="cover" />
          <View style={styles.content}>
            <View style={styles.header}>
              <Text style={styles.category}>{item.category}</Text>
              <View style={[styles.statusBadge, getStatusBadgeStyle(item.status)]}>
                <Text style={styles.statusText}>{item.status.replace('_', ' ')}</Text>
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
              <Text style={styles.location} numberOfLines={1}>📍 {formatLocation()}</Text>
              <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
          </View>
        </GlassCard>
      </Pressable>
    </Animated.View>
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
    marginBottom: 16,
  },
  cardContent: {
    padding: 0,
  },
  image: {
    width: '100%',
    height: 186,
    backgroundColor: '#DDE6FF',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  content: {
    padding: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  category: {
    ...type.cardTitle,
    textTransform: 'capitalize',
    flex: 1,
    marginRight: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusText: {
    color: palette.paperStrong,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  description: {
    ...type.body,
    marginBottom: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  imageMatchBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  imageMatchText: {
    ...type.caption,
    fontWeight: '700',
  },
  location: {
    color: palette.primaryDeep,
    fontFamily: type.body.fontFamily,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing.sm,
  },
  date: {
    ...type.caption,
  },
});
