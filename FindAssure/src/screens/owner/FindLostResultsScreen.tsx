import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { GlassCard } from '../../components/GlassCard';
import { ItemCard } from '../../components/ItemCard';
import { useAppTheme } from '../../context/ThemeContext';
import { FoundItem, RootStackParamList } from '../../types/models';

type FindLostResultsNavigationProp = StackNavigationProp<RootStackParamList, 'FindLostResults'>;
type FindLostResultsRouteProp = RouteProp<RootStackParamList, 'FindLostResults'>;

const FindLostResultsScreen = () => {
  const navigation = useNavigation<FindLostResultsNavigationProp>();
  const route = useRoute<FindLostResultsRouteProp>();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { foundItems } = route.params;

  const handleItemPress = (item: FoundItem) => {
    navigation.navigate('ItemDetail', { foundItem: item });
  };

  return (
    <View style={styles.container}>
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
            <Text style={styles.heroEyebrow}>Potential matches</Text>
            <Text style={styles.heroTitle}>{foundItems.length} item{foundItems.length !== 1 ? 's' : ''} found.</Text>
            <Text style={styles.heroBody}>Open a result to review the item details and continue with verification.</Text>
          </GlassCard>
        }
        ListEmptyComponent={
          <GlassCard style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No items found</Text>
            <Text style={styles.emptyBody}>We could not find any matching items right now. Your request is still recorded for future matches.</Text>
          </GlassCard>
        }
      />
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    listContent: {
      paddingTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
    },
    hero: {
      marginBottom: theme.spacing.md,
    },
    heroBadge: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.accentSoft,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      marginBottom: theme.spacing.sm,
    },
    heroBadgeText: {
      ...theme.type.caption,
      color: theme.colors.accent,
      fontWeight: '700',
    },
    heroEyebrow: {
      ...theme.type.label,
      color: theme.colors.accent,
      marginBottom: theme.spacing.xs,
    },
    heroTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.xs,
    },
    heroBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    emptyCard: {
      marginTop: theme.spacing.md,
    },
    emptyTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      textAlign: 'center',
      marginBottom: theme.spacing.sm,
    },
    emptyBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      textAlign: 'center',
    },
  });

export default FindLostResultsScreen;
