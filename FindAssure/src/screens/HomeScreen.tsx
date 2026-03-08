import { Ionicons } from '@expo/vector-icons';
import { CommonActions, useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import React, { useLayoutEffect, useMemo } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { GlassCard } from '../components/GlassCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAuth } from '../context/AuthContext';
import { useAppTheme } from '../context/ThemeContext';
import { RootStackParamList } from '../types/models';

type HomeScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Home'>;

const HomeScreen = () => {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { user } = useAuth();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const handleProfile = () => navigation.navigate('Profile');
  const handleLogin = () => navigation.navigate('Login');
  const handleSettings = () => navigation.navigate('Settings');
  const handleReportFound = () => navigation.navigate('ReportFoundStart');
  const handleFindLost = () => {
    if (!user) {
      navigation.navigate('Login');
      return;
    }
    navigation.navigate('FindLostStart');
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'FindAssure',
      headerTitle: () => <Text style={styles.headerTitle}>FindAssure</Text>,
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable onPress={() => navigation.navigate('Settings')} style={styles.headerButton}>
            <Ionicons name="settings-outline" size={20} color={theme.colors.textStrong} />
          </Pressable>
          <Pressable onPress={() => navigation.navigate(user ? 'Profile' : 'Login')} style={styles.headerButton}>
            <Ionicons name={user ? 'person-circle-outline' : 'log-in-outline'} size={20} color={theme.colors.textStrong} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, styles, theme.colors.textStrong, user]);

  useFocusEffect(
    React.useCallback(() => {
      const onBackPress = () => {
        if (user) {
          Alert.alert('Exit App', 'Do you want to exit the app?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Exit', style: 'destructive', onPress: () => BackHandler.exitApp() },
          ]);
          return true;
        }
        return false;
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [user])
  );

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(420)}>
          <GlassCard style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>Guided recovery</Text>
              </View>
              <Text style={styles.wordmark}>FindAssure</Text>
            </View>
            <Text style={styles.heroTitle}>Recover faster with clearer reporting and safer verification.</Text>
            <Text style={styles.heroBody}>
              A structured lost-and-found workflow that keeps reporting simple and keeps finder details protected until ownership is verified.
            </Text>
            <View style={styles.heroActions}>
              <PrimaryButton title="Report Found Item" onPress={handleReportFound} />
              <PrimaryButton title="Find Lost Item" onPress={handleFindLost} variant="secondary" />
            </View>
          </GlassCard>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(70).duration(420)}>
          <GlassCard style={styles.accountCard}>
            {user ? (
              <>
                <Text style={styles.sectionEyebrow}>Account</Text>
                <Text style={styles.sectionTitle}>Welcome back, {user.name.split(' ')[0]}.</Text>
                <Text style={styles.sectionBody}>
                  Resume your owner tools, review claimed items, or head into settings to adjust appearance and support options.
                </Text>
                <View style={styles.inlineActions}>
                  <PrimaryButton title="Open Profile" onPress={handleProfile} variant="secondary" />
                  <PrimaryButton title="Settings" onPress={handleSettings} variant="ghost" />
                  {user.role === 'admin' ? (
                    <PrimaryButton
                      title="Admin Dashboard"
                      onPress={() =>
                        navigation.dispatch(
                          CommonActions.navigate({
                            name: 'AdminDashboard',
                          })
                        )
                      }
                      variant="ghost"
                    />
                  ) : null}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.sectionEyebrow}>Guest mode</Text>
                <Text style={styles.sectionTitle}>Browse first. Sign in when you need ownership tools.</Text>
                <Text style={styles.sectionBody}>
                  Reporting found items stays open. Searching and claim workflows are available once you sign in as an owner.
                </Text>
                <PrimaryButton title="Login / Register" onPress={handleLogin} variant="secondary" />
              </>
            )}
          </GlassCard>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(120).duration(420)} style={styles.stack}>
          <ActionPanel
            icon="scan-outline"
            eyebrow="Founder flow"
            title="Create a report with layered proof"
            body="Capture a few clear photos, refine the public description, add verification questions, and submit the handoff details privately."
            onPress={handleReportFound}
          />
          <ActionPanel
            icon="locate-outline"
            eyebrow="Owner flow"
            title="Search using context, place, and confidence"
            body={`Use category, description, location memory, and an optional photo to narrow matches.${user ? '' : ' Sign in is required before search.'}`}
            onPress={handleFindLost}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(170).duration(420)}>
          <GlassCard>
            <Text style={styles.sectionEyebrow}>How it works</Text>
            <Text style={styles.sectionTitle}>A calmer path for both finders and owners.</Text>
            <View style={styles.steps}>
              {[
                'Founders submit photos, context, and verification questions.',
                'Owners search using details, location confidence, and optional photos.',
                'Verification unlocks finder contact details only after ownership is proven.',
              ].map((step, index) => (
                <View key={step} style={styles.stepRow}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepBadgeText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
            </View>
          </GlassCard>
        </Animated.View>
      </ScrollView>
    </View>
  );
};

const ActionPanel = ({
  icon,
  eyebrow,
  title,
  body,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  eyebrow: string;
  title: string;
  body: string;
  onPress: () => void;
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable onPress={onPress}>
      <GlassCard style={styles.actionCard}>
        <View style={styles.actionHeader}>
          <View style={styles.actionIconWrap}>
            <Ionicons name={icon} size={20} color={theme.colors.accent} />
          </View>
          <Ionicons name="arrow-forward" size={18} color={theme.colors.textSubtle} />
        </View>
        <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.sectionBody}>{body}</Text>
      </GlassCard>
    </Pressable>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      paddingTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
      gap: theme.spacing.md,
    },
    headerTitle: {
      ...theme.type.cardTitle,
      color: theme.colors.textStrong,
      fontSize: 16,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginRight: theme.spacing.sm,
    },
    headerButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: theme.colors.card,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hero: {
      padding: theme.spacing.lg,
    },
    heroTop: {
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
    wordmark: {
      ...theme.type.brand,
      color: theme.colors.accent,
      fontSize: 13,
      lineHeight: 16,
    },
    heroTitle: {
      ...theme.type.title,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.sm,
    },
    heroBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.lg,
    },
    heroActions: {
      gap: theme.spacing.sm,
    },
    accountCard: {
      marginTop: 0,
    },
    stack: {
      gap: theme.spacing.sm,
    },
    actionCard: {
      marginBottom: theme.spacing.sm,
    },
    actionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    actionIconWrap: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: theme.colors.accentSoft,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sectionEyebrow: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    sectionTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.sm,
    },
    actionTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.xs,
    },
    sectionBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    inlineActions: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
    },
    steps: {
      marginTop: theme.spacing.md,
      gap: theme.spacing.md,
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.md,
    },
    stepBadge: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: theme.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepBadgeText: {
      ...theme.type.caption,
      color: theme.colors.inverse,
      fontWeight: '800',
    },
    stepText: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      flex: 1,
    },
  });

export default HomeScreen;
