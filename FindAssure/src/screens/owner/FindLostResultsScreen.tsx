import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, FoundItem } from '../../types/models';
import { ItemCard } from '../../components/ItemCard';
import { GlassCard } from '../../components/GlassCard';
import { gradients, radius, spacing, type, palette } from '../../theme/designSystem';

type FindLostResultsNavigationProp = StackNavigationProp<RootStackParamList, 'FindLostResults'>;
type FindLostResultsRouteProp = RouteProp<RootStackParamList, 'FindLostResults'>;

const FindLostResultsScreen = () => {
  const navigation = useNavigation<FindLostResultsNavigationProp>();
  const route = useRoute<FindLostResultsRouteProp>();
  const { foundItems } = route.params;

  const handleItemPress = (item: FoundItem) => {
    navigation.navigate('ItemDetail', { foundItem: item });
  };

  return (
    <LinearGradient colors={gradients.appBackground} style={styles.container}>
      <FlatList
        data={foundItems}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => <ItemCard item={item} onPress={() => handleItemPress(item)} />}
        ListHeaderComponent={
          <GlassCard style={styles.hero}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Search results</Text>
            </View>
            <Text style={styles.heroEyebrow}>Search results</Text>
            <Text style={styles.heroTitle}>Potential matches</Text>
            <Text style={styles.heroBody}>
              {foundItems.length} item{foundItems.length !== 1 ? 's' : ''} found for this search.
            </Text>
          </GlassCard>
        }
        ListEmptyComponent={
          <GlassCard style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No items found</Text>
            <Text style={styles.emptyBody}>We could not find any matching items right now. Your request is still recorded for future matches.</Text>
          </GlassCard>
        }
      />
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  hero: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: palette.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    marginBottom: spacing.sm,
  },
  heroBadgeText: {
    ...type.caption,
    color: palette.primaryDeep,
    fontWeight: '700',
  },
  heroEyebrow: {
    ...type.label,
    color: palette.primaryDeep,
    marginBottom: spacing.xs,
  },
  heroTitle: {
    ...type.section,
    color: palette.ink,
    marginBottom: spacing.xs,
  },
  heroBody: {
    ...type.body,
    color: palette.inkSoft,
  },
  emptyCard: {
    marginTop: spacing.md,
  },
  emptyTitle: {
    ...type.section,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  emptyBody: {
    ...type.body,
    textAlign: 'center',
  },
});

export default FindLostResultsScreen;
