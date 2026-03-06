// AdminUsersScreen – User Management for Admin
import React, { useState, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  Alert, 
  RefreshControl, 
  TouchableOpacity,
  ActivityIndicator 
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, User } from '../../types/models';
import { adminApi } from '../../api/adminApi';
import { PrimaryButton } from '../../components/PrimaryButton';

type AdminUsersNavigationProp = StackNavigationProp<RootStackParamList, 'AdminUsers'>;
const POLL_INTERVAL_MS = 10000;

const AdminUsersScreen = () => {
  const navigation = useNavigation<AdminUsersNavigationProp>();
  
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [suspendingUserId, setSuspendingUserId] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const fetchUsers = useCallback(async (silent: boolean = false) => {
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
    fetchUsers(false);
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
      
      Alert.alert(
        'Success',
        `User ${user.name || user.email} has been deleted successfully.`,
        [{ text: 'OK' }]
      );
      
      // Remove user from local state
      setUsers(prevUsers => prevUsers.filter(u => u._id !== user._id));
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
      Alert.alert(
        'Suspend Duration',
        `Choose suspension period for ${user.name || user.email}`,
        [
          { text: '3 Days', onPress: () => confirmToggleSuspension(user, true, '3d') },
          { text: '7 Days', onPress: () => confirmToggleSuspension(user, true, '7d') },
          { text: 'Until Unsuspend', onPress: () => confirmToggleSuspension(user, true, 'manual') },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    Alert.alert(
      'Unsuspend User',
      `Unsuspend ${user.name || user.email}?\n\nThis user will be allowed to use the app again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unsuspend',
          style: 'default',
          onPress: () => confirmToggleSuspension(user, false),
        },
      ]
    );
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

      setUsers(prevUsers =>
        prevUsers.map(u => (u._id === user._id ? { ...u, ...updatedUser } : u))
      );

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
    const isSuspicious = Boolean(user.isSuspicious || user.suspiciousSeverity === 'critical');
    const isSuspended = Boolean(user.isSuspended);

    return (
      <View key={user._id} style={[styles.userCard, isSuspicious && styles.suspiciousUserCard]}>
        <View style={styles.userInfo}>
          <View style={styles.userHeader}>
            <Text style={styles.userName}>{user.name || 'No Name'}</Text>
            <View style={[
              styles.roleBadge,
              isAdmin ? styles.adminBadge : styles.ownerBadge
            ]}>
              <Text style={styles.roleText}>{user.role.toUpperCase()}</Text>
            </View>
          </View>
          
          <Text style={styles.userEmail}>{user.email}</Text>
          {user.phone && <Text style={styles.userPhone}>📱 {user.phone}</Text>}

          {isSuspended && (
            <View style={[styles.suspiciousBadge, styles.suspendedBadge]}>
              <Text style={styles.suspiciousText}>SUSPENDED</Text>
            </View>
          )}

          {isSuspended && user.suspendedUntil && (
            <Text style={styles.reasonText}>
              Until: {new Date(user.suspendedUntil).toLocaleString()}
            </Text>
          )}

          {!isSuspended && isSuspicious && (
            <View style={[styles.suspiciousBadge, styles.criticalBadge]}>
              <Text style={styles.suspiciousText}>SUSPICIOUS - CRITICAL</Text>
            </View>
          )}

          {!!user.fraudRiskScore && (
            <Text style={styles.riskText}>
              Fraud Risk: {Math.round((user.fraudRiskScore || 0) * 100)}%
            </Text>
          )}

          {isSuspicious && !!(user.suspiciousReason || user.fraudReasons?.length) && (
            <Text style={styles.reasonText} numberOfLines={2}>
              Reason: {user.suspiciousReason || user.fraudReasons?.[0]}
            </Text>
          )}
          
          <Text style={styles.userDate}>
            Joined: {new Date(user.createdAt).toLocaleDateString()}
          </Text>
        </View>

        <View style={styles.actionButtons}>
          {!isAdmin && (
            <TouchableOpacity
              style={[
                styles.suspendButton,
                isSuspending && styles.actionButtonDisabled,
              ]}
              onPress={() => handleToggleSuspension(user)}
              disabled={isSuspending || isDeleting}
            >
              {isSuspending ? (
                <ActivityIndicator size="small" color="#C62828" />
              ) : (
                <Text style={styles.suspendButtonText}>
                  {isSuspended ? 'Unsuspend' : 'Suspend'}
                </Text>
              )}
            </TouchableOpacity>
          )}

          {!isAdmin && (
            <TouchableOpacity
              style={[styles.deleteButton, (isDeleting || isSuspending) && styles.actionButtonDisabled]}
              onPress={() => handleDeleteUser(user)}
              disabled={isDeleting || isSuspending}
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color="#C62828" />
              ) : (
                <Text style={styles.deleteButtonText}>Delete</Text>
              )}
            </TouchableOpacity>
          )}
          {isAdmin && (
            <View style={styles.protectedLabel}>
              <Text style={styles.protectedText}>Protected</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4A90E2" />
        <Text style={styles.loadingText}>Loading users...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>User Management</Text>
            <Text style={styles.subtitle}>Total Users: {users.length}</Text>
            <Text style={styles.subtitle}>
              Live updates every {Math.floor(POLL_INTERVAL_MS / 1000)}s
              {lastUpdatedAt ? ` • Last: ${lastUpdatedAt.toLocaleTimeString()}` : ''}
            </Text>
          </View>

          <View style={styles.statsContainer}>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>
                {users.filter(u => u.role === 'admin').length}
              </Text>
              <Text style={styles.statLabel}>Admins</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>
                {users.filter(u => u.role === 'owner').length}
              </Text>
              <Text style={styles.statLabel}>Owners</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>All Users</Text>
            {users.map(user => renderUserCard(user))}
            
            {users.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No users found</Text>
              </View>
            )}
          </View>

          <PrimaryButton
            title="Back to Dashboard"
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          />
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#666666',
    marginTop: 12,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666666',
  },
  statsContainer: {
    flexDirection: 'row',
    marginBottom: 24,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statNumber: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#4A90E2',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#666666',
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 16,
  },
  userCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  suspiciousUserCard: {
    backgroundColor: '#FFEBEE',
    borderWidth: 1,
    borderColor: '#F5C2C7',
  },
  userInfo: {
    marginBottom: 12,
  },
  userHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  userName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333333',
    flex: 1,
  },
  roleBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  adminBadge: {
    backgroundColor: '#FF6B6B',
  },
  ownerBadge: {
    backgroundColor: '#4A90E2',
  },
  roleText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  userEmail: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 4,
  },
  userPhone: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 4,
  },
  userDate: {
    fontSize: 12,
    color: '#999999',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  suspiciousBadge: {
    marginTop: 6,
    marginBottom: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  criticalBadge: {
    backgroundColor: '#B71C1C',
  },
  suspendedBadge: {
    backgroundColor: '#424242',
  },
  suspiciousText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  riskText: {
    fontSize: 12,
    color: '#C62828',
    fontWeight: '600',
    marginTop: 2,
  },
  reasonText: {
    fontSize: 12,
    color: '#666666',
    marginTop: 2,
  },
  suspendButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 96,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C62828',
  },
  suspendButtonText: {
    color: '#C62828',
    fontSize: 14,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C62828',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  actionButtonDisabled: {
    backgroundColor: '#CCCCCC',
  },
  deleteButtonText: {
    color: '#C62828',
    fontSize: 14,
    fontWeight: '600',
  },
  protectedLabel: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#DDDDDD',
  },
  protectedText: {
    color: '#999999',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#999999',
  },
  backButton: {
    marginTop: 10,
  },
});

export default AdminUsersScreen;
