import React, { useCallback, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList, User } from '../../types/models';
import { adminApi } from '../../api/adminApi';
import { GlassCard } from '../../components/GlassCard';
import { LoadingScreen } from '../../components/LoadingScreen';
import { PrimaryButton } from '../../components/PrimaryButton';
import { StaggeredEntrance } from '../../components/StaggeredEntrance';
import { useAppTheme } from '../../context/ThemeContext';
import {
  getAdminPalette,
  getAdminRiskTone,
  getAdminRoleTone,
  getAdminUserCardTone,
} from './adminTheme';

type AdminUsersNavigationProp = StackNavigationProp<RootStackParamList, 'AdminUsers'>;
const POLL_INTERVAL_MS = 10000;

const AdminUsersScreen = () => {
  const navigation = useNavigation<AdminUsersNavigationProp>();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const adminPalette = useMemo(() => getAdminPalette(theme), [theme]);

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [suspendingUserId, setSuspendingUserId] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const fetchUsers = useCallback(async (silent = false) => {
    try {
      const usersData = await adminApi.getAllUsers();
      setUsers(usersData);
      setLastUpdatedAt(new Date());
    } catch (error: any) {
      if (!silent) {
        Alert.alert('Error', error.message || 'Failed to load users');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const run = async () => {
        if (!isActive) return;
        await fetchUsers(true);
      };

      void run();
      const intervalId = setInterval(() => {
        void run();
      }, POLL_INTERVAL_MS);

      return () => {
        isActive = false;
        clearInterval(intervalId);
      };
    }, [fetchUsers])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    void fetchUsers(false);
  };

  const handleDeleteUser = (user: User) => {
    if (user.role === 'admin') {
      Alert.alert('Cannot Delete', 'Admin users cannot be deleted for security reasons.');
      return;
    }

    Alert.alert(
      'Delete User',
      `Are you sure you want to delete ${user.name || user.email}?\n\nThis will permanently remove the user from both MongoDB and Firebase.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => confirmDelete(user),
        },
      ]
    );
  };

  const confirmDelete = async (user: User) => {
    setDeletingUserId(user._id);
    try {
      await adminApi.deleteUser(user._id);
      Alert.alert('Success', `User ${user.name || user.email} has been deleted successfully.`, [{ text: 'OK' }]);
      setUsers((prevUsers) => prevUsers.filter((u) => u._id !== user._id));
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to delete user');
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleToggleSuspension = (user: User) => {
    if (user.role === 'admin') {
      Alert.alert('Protected User', 'Admin users cannot be suspended.');
      return;
    }

    const willSuspend = !user.isSuspended;
    if (willSuspend) {
      Alert.alert('Suspend Duration', `Choose suspension period for ${user.name || user.email}`, [
        { text: '3 Days', onPress: () => confirmToggleSuspension(user, true, '3d') },
        { text: '7 Days', onPress: () => confirmToggleSuspension(user, true, '7d') },
        { text: 'Until Unsuspend', onPress: () => confirmToggleSuspension(user, true, 'manual') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }

    Alert.alert('Unsuspend User', `Unsuspend ${user.name || user.email}?\n\nThis user will be allowed to use the app again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unsuspend',
        style: 'default',
        onPress: () => confirmToggleSuspension(user, false),
      },
    ]);
  };

  const confirmToggleSuspension = async (
    user: User,
    willSuspend: boolean,
    suspendFor?: '3d' | '7d' | 'manual'
  ) => {
    setSuspendingUserId(user._id);
    try {
      const updatedUser = await adminApi.updateUserSuspension(
        user._id,
        willSuspend,
        willSuspend && user.isSuspicious
          ? 'Suspended by admin due to suspicious fraud behavior'
          : undefined,
        suspendFor
      );

      setUsers((prevUsers) => prevUsers.map((u) => (u._id === user._id ? { ...u, ...updatedUser } : u)));

      Alert.alert(
        'Success',
        willSuspend
          ? `${user.name || user.email} has been suspended${suspendFor === '3d' ? ' for 3 days' : suspendFor === '7d' ? ' for 7 days' : ''}.`
          : `${user.name || user.email} has been unsuspended.`
      );
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update suspension status');
    } finally {
      setSuspendingUserId(null);
    }
  };

  const renderUserCard = (user: User) => {
    const isDeleting = deletingUserId === user._id;
    const isSuspending = suspendingUserId === user._id;
    const isAdmin = user.role === 'admin';
    const suspiciousBehaviorCount = Number(user.suspiciousBehaviorCount || 0);
    const suspiciousBehaviorEvents = Array.isArray(user.suspiciousBehaviorEvents) ? user.suspiciousBehaviorEvents : [];
    const isSuspicious = Boolean(user.isSuspicious || user.suspiciousSeverity === 'critical');
    const isSuspended = Boolean(user.isSuspended);
    const roleTone = getAdminRoleTone(theme, user.role);
    const riskTone = isSuspended
      ? getAdminRiskTone(theme, 'suspended')
      : isSuspicious
        ? getAdminRiskTone(theme, 'critical')
        : getAdminRiskTone(theme, 'protected');
    const cardTone = getAdminUserCardTone(theme, { isAdmin, isSuspended, isSuspicious });
    const handleSeeMoreSuspicious = () => {
      if (!suspiciousBehaviorEvents.length) {
        Alert.alert('Suspicious Behavior', 'No suspicious behavior event details are available yet.');
        return;
      }
      const lines = suspiciousBehaviorEvents.slice(-5).reverse().map((evt, index) => {
        const time = evt.created_at ? new Date(evt.created_at).toLocaleString() : 'Unknown time';
        const score = typeof evt.suspicion_score === 'number'
          ? `${Math.round(evt.suspicion_score * 100)}%`
          : 'N/A';
        const factors = Array.isArray(evt.top_negative_factors) && evt.top_negative_factors.length
          ? evt.top_negative_factors.join(', ')
          : 'No factors listed';
        const summary = evt.ai_behavior_summary ? `\nSummary: ${evt.ai_behavior_summary}` : '';
        return `${index + 1}. ${time} | Score ${score}\nFactors: ${factors}${summary}`;
      });
      Alert.alert(
        `Suspicious behavior (${suspiciousBehaviorCount})`,
        lines.join('\n\n'),
        [{ text: 'Close' }]
      );
    };

    return (
      <GlassCard
        key={user._id}
        style={[styles.userCard, { borderColor: cardTone.borderColor, backgroundColor: cardTone.backgroundColor }]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.userHeader}>
            <View style={styles.userNameBlock}>
              <Text style={styles.userName}>{user.name || 'No Name'}</Text>
              <Text style={styles.userEmail}>{user.email}</Text>
            </View>
            <View style={[styles.roleBadge, { backgroundColor: roleTone.backgroundColor }]}>
              <Text style={[styles.roleText, { color: roleTone.textColor }]}>{user.role.toUpperCase()}</Text>
            </View>
          </View>
        </View>

        <View style={styles.infoGrid}>
          {user.phone ? (
            <View style={styles.infoRow}>
              <Ionicons name="call-outline" size={16} color={theme.colors.textMuted} />
              <Text style={styles.infoText}>{user.phone}</Text>
            </View>
          ) : null}
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={16} color={theme.colors.textMuted} />
            <Text style={styles.infoText}>Joined {new Date(user.createdAt).toLocaleDateString()}</Text>
          </View>
          {isSuspended && user.suspendedUntil ? (
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={16} color={theme.colors.textMuted} />
              <Text style={styles.infoText}>Suspended until {new Date(user.suspendedUntil).toLocaleString()}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.badgeRow}>
          {(isSuspicious || isSuspended || isAdmin) && (
            <View style={[styles.signalBadge, { backgroundColor: riskTone.backgroundColor }]}>
              <Text style={[styles.signalBadgeText, { color: riskTone.textColor }]}>
                {isSuspended ? 'Suspended' : isSuspicious ? 'Critical risk' : 'Protected account'}
              </Text>
            </View>
          )}
          {!!user.fraudRiskScore && (
            <View style={[styles.signalBadge, { backgroundColor: theme.colors.warningSoft }]}>
              <Text style={[styles.signalBadgeText, { color: theme.colors.warning }]}>
                Fraud risk {Math.round((user.fraudRiskScore || 0) * 100)}%
              </Text>
            </View>
          )}
          {suspiciousBehaviorCount > 0 && (
            <View style={[styles.signalBadge, { backgroundColor: theme.colors.dangerSoft }]}>
              <Text style={[styles.signalBadgeText, { color: theme.colors.danger }]}>
                Suspicious attempts {suspiciousBehaviorCount}
              </Text>
            </View>
          )}
        </View>

        {isSuspicious && !!(user.suspiciousReason || user.fraudReasons?.length) ? (
          <View style={styles.reasonBlock}>
            <Text style={styles.reasonLabel}>Reason</Text>
            <Text style={styles.reasonText} numberOfLines={3}>
              {user.suspiciousReason || user.fraudReasons?.[0]}
            </Text>
            {suspiciousBehaviorCount > 5 ? (
              <PrimaryButton
                title="See more"
                onPress={handleSeeMoreSuspicious}
                variant="ghost"
                style={styles.seeMoreButton}
              />
            ) : null}
          </View>
        ) : null}

        <View style={styles.actionButtons}>
          {!isAdmin ? (
            <>
              <PrimaryButton
                title={isSuspended ? 'Unsuspend' : 'Suspend'}
                onPress={() => handleToggleSuspension(user)}
                disabled={isDeleting}
                loading={isSuspending}
                variant="secondary"
                style={StyleSheet.flatten([styles.actionButton, styles.suspendButton, { borderColor: adminPalette.accent }])}
                textStyle={{ color: adminPalette.accent }}
              />
              <PrimaryButton
                title="Delete"
                onPress={() => handleDeleteUser(user)}
                disabled={isSuspending}
                loading={isDeleting}
                variant="danger"
                style={styles.actionButton}
              />
            </>
          ) : (
            <GlassCard style={styles.protectedLabel} intensity={24}>
              <Text style={styles.protectedText}>Protected administrator account</Text>
            </GlassCard>
          )}
        </View>
      </GlassCard>
    );
  };

  if (loading) {
    return (
      <LoadingScreen
        message="Loading user moderation"
        subtitle="Syncing current account status, risk signals, and suspension controls."
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
          <GlassCard style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroCopy}>
                <View style={[styles.heroBadge, { backgroundColor: adminPalette.accentSoft }]}>
                  <Text style={[styles.heroBadgeText, { color: adminPalette.accentText }]}>User moderation</Text>
                </View>
                <Text style={styles.heroTitle}>Monitor account health and take action.</Text>
                <Text style={styles.heroBody}>
                  Review suspicious behavior, apply suspensions, and protect administrator access from one queue.
                </Text>
              </View>
              <View style={[styles.heroIconWrap, { backgroundColor: adminPalette.accentSoft }]}>
                <Ionicons name="shield-half-outline" size={30} color={adminPalette.accent} />
              </View>
            </View>
            <Text style={styles.heroMeta}>
              Live updates every {Math.floor(POLL_INTERVAL_MS / 1000)}s
              {lastUpdatedAt ? ` • Last sync ${lastUpdatedAt.toLocaleTimeString()}` : ''}
            </Text>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={90}>
          <View style={styles.statsGrid}>
            {[
              { label: 'Admins', value: users.filter((u) => u.role === 'admin').length },
              { label: 'Owners', value: users.filter((u) => u.role === 'owner').length },
              { label: 'Flagged', value: users.filter((u) => u.isSuspicious || u.suspiciousSeverity === 'critical').length },
            ].map((stat) => (
              <GlassCard key={stat.label} style={styles.statCard} intensity={24}>
                <Text style={styles.statLabel}>{stat.label}</Text>
                <Text style={[styles.statNumber, { color: adminPalette.accent }]}>{stat.value}</Text>
              </GlassCard>
            ))}
          </View>
        </StaggeredEntrance>

        <StaggeredEntrance delay={140}>
          <GlassCard style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>Moderation queue</Text>
                <Text style={styles.sectionTitle}>All users</Text>
              </View>
              <Text style={styles.sectionMeta}>{users.length} records</Text>
            </View>

            {users.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No users found</Text>
                <Text style={styles.emptyText}>Account records will appear here after the next backend sync.</Text>
              </View>
            ) : (
              users.map((user) => renderUserCard(user))
            )}
          </GlassCard>
        </StaggeredEntrance>

        <PrimaryButton
          title="Back to Dashboard"
          onPress={() => navigation.goBack()}
          variant="secondary"
          size="lg"
          style={styles.backButton}
        />
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
    heroCard: {
      padding: theme.spacing.lg,
    },
    heroTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.md,
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
    heroMeta: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
    },
    heroIconWrap: {
      width: 56,
      height: 56,
      borderRadius: 28,
      justifyContent: 'center',
      alignItems: 'center',
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.md,
    },
    statCard: {
      flexGrow: 1,
      flexBasis: '30%',
      minWidth: 100,
      alignItems: 'center',
    },
    statLabel: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.sm,
    },
    statNumber: {
      ...theme.type.hero,
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
    sectionMeta: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
    },
    userCard: {
      marginBottom: theme.spacing.md,
      borderWidth: 1,
    },
    cardHeader: {
      marginBottom: theme.spacing.md,
    },
    userHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: theme.spacing.md,
    },
    userNameBlock: {
      flex: 1,
    },
    userName: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      marginBottom: 2,
    },
    userEmail: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    roleBadge: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
    },
    roleText: {
      ...theme.type.caption,
      fontWeight: '700',
    },
    infoGrid: {
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    infoText: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      flex: 1,
    },
    badgeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    signalBadge: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
    },
    signalBadgeText: {
      ...theme.type.caption,
      fontWeight: '700',
    },
    reasonBlock: {
      backgroundColor: theme.colors.cardMuted,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    reasonLabel: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
      marginBottom: 4,
      textTransform: 'uppercase',
    },
    reasonText: {
      ...theme.type.body,
      color: theme.colors.textStrong,
    },
    seeMoreButton: {
      marginTop: theme.spacing.sm,
      alignSelf: 'flex-start',
    },
    actionButtons: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      alignItems: 'stretch',
    },
    actionButton: {
      flex: 1,
    },
    suspendButton: {
      borderWidth: 1,
    },
    protectedLabel: {
      width: '100%',
    },
    protectedText: {
      ...theme.type.bodyStrong,
      color: theme.colors.textMuted,
      textAlign: 'center',
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
    backButton: {
      marginTop: theme.spacing.xs,
    },
  });

export default AdminUsersScreen;
