import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, BackHandler, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CommonActions, useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList, FoundItem, AdminOverview } from '../../types/models';
import { itemsApi } from '../../api/itemsApi';
import { adminApi } from '../../api/adminApi';
import { ItemCard } from '../../components/ItemCard';
import { AnimatedHeroIllustration } from '../../components/AnimatedHeroIllustration';
import { GlassCard } from '../../components/GlassCard';
import { LoadingScreen } from '../../components/LoadingScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StaggeredEntrance } from '../../components/StaggeredEntrance';
import { useAuth } from '../../context/AuthContext';
import { useAppTheme } from '../../context/ThemeContext';
import { getAdminPalette } from './adminTheme';

type AdminDashboardNavigationProp = StackNavigationProp<RootStackParamList, 'AdminDashboard'>;

const AdminDashboardScreen = () => {
  const navigation = useNavigation<AdminDashboardNavigationProp>();
  const { signOut } = useAuth();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const adminPalette = useMemo(() => getAdminPalette(theme), [theme]);

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [foundItems, setFoundItems] = useState<FoundItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [overviewData, itemsData] = await Promise.all([adminApi.getOverview(), itemsApi.getFoundItems()]);
      setOverview(overviewData);
      setFoundItems(itemsData);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleLogout = useCallback(() => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'Home' }],
              })
            );
          } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to logout');
          }
        },
      },
    ]);
  }, [navigation, signOut]);

  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        Alert.alert('Exit Dashboard', 'Do you want to logout?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Logout', style: 'destructive', onPress: handleLogout },
        ]);
        return true;
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [handleLogout])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    void fetchData();
  };

  const handleItemPress = (item: FoundItem) => {
    navigation.navigate('AdminItemDetail', { foundItem: item });
  };

  if (loading) {
    return (
      <LoadingScreen
        message="Loading admin workspace"
        subtitle="Refreshing oversight metrics and current found-item activity."
      />
    );
  }

  return (
    <LinearGradient colors={theme.gradients.appBackground} style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={adminPalette.accent}
            colors={[adminPalette.accent]}
            progressBackgroundColor={theme.colors.card}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <StaggeredEntrance delay={20}>
          <GlassCard style={styles.hero}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroCopy}>
                <View style={[styles.heroBadge, { backgroundColor: adminPalette.accentSoft }]}>
                  <Text style={[styles.heroBadgeText, { color: adminPalette.accentText }]}>Admin overview</Text>
                </View>
                <Text style={styles.heroTitle}>Moderation and verification control.</Text>
                <Text style={styles.heroBody}>
                  Monitor platform health, inspect incoming found items, and jump into user moderation quickly.
                </Text>
              </View>
              <AnimatedHeroIllustration size={104} variant="auth" />
            </View>
          </GlassCard>
        </StaggeredEntrance>

        {overview ? (
          <StaggeredEntrance delay={90}>
            <View style={styles.statsGrid}>
              {[
                { label: 'Total users', value: overview.totalUsers, icon: 'people-outline' as const },
                { label: 'Found items', value: overview.totalFoundItems, icon: 'cube-outline' as const },
                { label: 'Lost requests', value: overview.totalLostRequests, icon: 'search-outline' as const },
                {
                  label: 'Pending checks',
                  value: overview.pendingVerifications,
                  icon: 'shield-checkmark-outline' as const,
                },
              ].map((stat) => (
                <GlassCard key={stat.label} style={styles.statCard} intensity={24}>
                  <View style={styles.statTopRow}>
                    <View style={[styles.statIconWrap, { backgroundColor: adminPalette.accentSoft }]}>
                      <Ionicons name={stat.icon} size={18} color={adminPalette.accent} />
                    </View>
                    <Text style={[styles.statLabel, stat.label === 'Pending checks' && styles.statLabelEmphasis]}>
                      {stat.label}
                    </Text>
                  </View>
                  <Text style={[styles.statNumber, { color: adminPalette.accent }]}>{stat.value}</Text>
                </GlassCard>
              ))}
            </View>
          </StaggeredEntrance>
        ) : null}

        <StaggeredEntrance delay={140}>
          <GlassCard style={styles.actionCard}>
            <Text style={styles.sectionEyebrow}>Controls</Text>
            <Text style={styles.sectionTitle}>Admin tools</Text>
            <Text style={styles.sectionBody}>
              Open user moderation, refresh the oversight feed, or sign out of the protected workspace.
            </Text>
            <View style={styles.actionButtons}>
              <PrimaryButton
                title="Manage Users"
                onPress={() => navigation.navigate('AdminUsers')}
                size="lg"
                style={StyleSheet.flatten([styles.actionButton, { backgroundColor: adminPalette.accent }])}
              />
              <PrimaryButton
                title="Logout"
                onPress={handleLogout}
                size="lg"
                variant="secondary"
                textStyle={{ color: adminPalette.accent }}
                style={StyleSheet.flatten([styles.actionButton, styles.logoutButton, { borderColor: adminPalette.accent }])}
              />
            </View>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={180}>
          <GlassCard style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>Inventory oversight</Text>
                <Text style={styles.sectionTitle}>Recent found items</Text>
              </View>
              <Text style={styles.sectionMeta}>{foundItems.length} records</Text>
            </View>

            {foundItems.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No found items yet</Text>
                <Text style={styles.emptyText}>New reports will appear here as soon as founders submit them.</Text>
              </View>
            ) : (
              foundItems.map((item) => <ItemCard key={item._id} item={item} onPress={() => handleItemPress(item)} />)
            )}
          </GlassCard>
        </StaggeredEntrance>
      </ScrollView>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    content: {
      paddingTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
      gap: theme.spacing.md,
    },
    hero: {
      padding: theme.spacing.lg,
    },
    heroTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: theme.spacing.md,
    },
    heroCopy: {
      flex: 1,
    },
    heroBadge: {
      alignSelf: 'flex-start',
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      marginBottom: theme.spacing.sm,
    },
    heroBadgeText: {
      ...theme.type.caption,
      fontWeight: '700',
    },
    heroTitle: {
      ...theme.type.title,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.sm,
    },
    heroBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.md,
    },
    statCard: {
      flexBasis: '47%',
      flexGrow: 1,
      minWidth: 150,
    },
    statTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.lg,
    },
    statIconWrap: {
      width: 34,
      height: 34,
      borderRadius: 17,
      justifyContent: 'center',
      alignItems: 'center',
    },
    statLabel: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      flex: 1,
    },
    statLabelEmphasis: {
      color: theme.colors.textStrong,
    },
    statNumber: {
      ...theme.type.hero,
    },
    actionCard: {
      marginBottom: 0,
    },
    actionButtons: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.lg,
    },
    actionButton: {
      width: '100%',
    },
    logoutButton: {
      borderWidth: 1,
    },
    sectionCard: {
      marginBottom: 0,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.md,
      gap: theme.spacing.md,
    },
    sectionEyebrow: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    sectionTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
    },
    sectionBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    sectionMeta: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
    },
    emptyState: {
      backgroundColor: theme.colors.cardMuted,
      borderRadius: theme.radius.md,
      paddingVertical: theme.spacing.xl,
      paddingHorizontal: theme.spacing.lg,
      alignItems: 'center',
    },
    emptyTitle: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.xs,
    },
    emptyText: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      textAlign: 'center',
    },
  });

export default AdminDashboardScreen;
