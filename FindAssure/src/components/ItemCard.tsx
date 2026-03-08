import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useAppTheme } from '../context/ThemeContext';
import { FoundItem } from '../types/models';
import { getDisplayImageUri } from '../utils/cloudinaryImage';
import { getVisualMatchDisplay } from '../utils/visualMatch';
import { GlassCard } from './GlassCard';

interface ItemCardProps {
  item: FoundItem;
  onPress: () => void;
}

export const ItemCard: React.FC<ItemCardProps> = ({ item, onPress }) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const scale = useSharedValue(1);
  const visualMatch = getVisualMatchDisplay(item.imageMatch?.score);

  const formatLocation = () => {
    if (!item.found_location || item.found_location.length === 0) return 'Location not specified';
    const loc = item.found_location[0];
    let locationStr = loc.location;
    if (loc.floor_id) locationStr += ` - Floor ${loc.floor_id}`;
    if (loc.hall_name) locationStr += ` - ${loc.hall_name}`;
    return locationStr;
  };

  const getImageMatchStyle = (score: number) => {
    if (score >= 0.8) {
      return { backgroundColor: theme.colors.successSoft, color: theme.colors.success };
    }

    if (score >= 0.6) {
      return { backgroundColor: theme.colors.warningSoft, color: theme.colors.warning };
    }

    return { backgroundColor: theme.colors.cardMuted, color: theme.colors.textMuted };
  };

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
        <GlassCard style={styles.card} contentStyle={styles.cardContent}>
          <Image source={{ uri: getDisplayImageUri(item.imageUrl) }} style={styles.image} contentFit="cover" cachePolicy="memory-disk" transition={120} />
          <View style={styles.content}>
            <View style={styles.header}>
              <Text style={styles.category}>{item.category}</Text>
              <View style={[styles.statusBadge, getStatusBadgeStyle(theme, item.status)]}>
                <Text style={styles.statusText}>{item.status.replace('_', ' ')}</Text>
              </View>
            </View>
            <Text style={styles.description} numberOfLines={2}>
              {item.description}
            </Text>
            {visualMatch ? (
              <View
                style={[
                  styles.imageMatchBadge,
                  { backgroundColor: getImageMatchStyle(visualMatch.normalizedScore).backgroundColor },
                ]}
              >
                <Text style={[styles.imageMatchText, { color: getImageMatchStyle(visualMatch.normalizedScore).color }]}>
                  {visualMatch.label}
                </Text>
              </View>
            ) : null}
            <View style={styles.footer}>
              <Text style={styles.location} numberOfLines={1}>
                {`Location: ${formatLocation()}`}
              </Text>
              <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
          </View>
        </GlassCard>
      </Pressable>
    </Animated.View>
  );
};

const getStatusBadgeStyle = (theme: ReturnType<typeof useAppTheme>['theme'], status: string) => {
  switch (status) {
    case 'available':
      return { backgroundColor: theme.colors.success };
    case 'pending_verification':
      return { backgroundColor: theme.colors.warning };
    case 'claimed':
      return { backgroundColor: theme.colors.textSubtle };
    default:
      return { backgroundColor: theme.colors.textMuted };
  }
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    card: {
      marginBottom: 14,
    },
    cardContent: {
      padding: 0,
    },
    image: {
      width: '100%',
      height: 176,
      backgroundColor: theme.colors.accentMuted,
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
    },
    content: {
      padding: theme.spacing.md,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    category: {
      ...theme.type.cardTitle,
      color: theme.colors.textStrong,
      textTransform: 'capitalize',
      flex: 1,
      marginRight: theme.spacing.sm,
    },
    statusBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: theme.radius.pill,
    },
    statusText: {
      color: theme.colors.onTint,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'capitalize',
    },
    description: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.sm,
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
      borderRadius: theme.radius.pill,
      marginBottom: theme.spacing.sm,
    },
    imageMatchText: {
      ...theme.type.caption,
      fontWeight: '700',
    },
    location: {
      color: theme.colors.accent,
      fontFamily: theme.type.body.fontFamily,
      fontSize: 13,
      fontWeight: '600',
      flex: 1,
      marginRight: theme.spacing.sm,
    },
    date: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
    },
  });
