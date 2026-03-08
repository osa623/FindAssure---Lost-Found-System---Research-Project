import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useLayoutEffect, useMemo } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AnimatedHeroIllustration } from '../components/AnimatedHeroIllustration';
import { GlassCard } from '../components/GlassCard';
import { StaggeredEntrance } from '../components/StaggeredEntrance';
import { useAuth } from '../context/AuthContext';
import { useAppTheme } from '../context/ThemeContext';
import { RootStackParamList } from '../types/models';

type HomeScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Home'>;

const HomeScreen = () => {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { user } = useAuth();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const handleSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  const handleProfile = useCallback(() => navigation.navigate(user ? 'Profile' : 'Login'), [navigation, user]);
  const handleReportFound = useCallback(() => navigation.navigate('ReportFoundStart'), [navigation]);
  const handleFindLost = useCallback(() => {
    if (!user) {
      navigation.navigate('Login');
      return;
    }

    navigation.navigate('FindLostStart');
  }, [navigation, user]);
  const handleAdmin = useCallback(() => navigation.navigate('AdminDashboard'), [navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'FindAssure',
      headerTitle: () => <Text style={styles.headerTitle}>FindAssure</Text>,
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable onPress={handleSettings} style={styles.headerButton}>
            <Ionicons name="settings-outline" size={20} color={theme.colors.textStrong} />
          </Pressable>
          <Pressable onPress={handleProfile} style={styles.headerButton}>
            <Ionicons name={user ? 'person-circle-outline' : 'log-in-outline'} size={20} color={theme.colors.textStrong} />
          </Pressable>
        </View>
      ),
    });
  }, [handleProfile, handleSettings, navigation, styles, theme.colors.textStrong, user]);

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
    <LinearGradient colors={theme.gradients.appBackground} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <StaggeredEntrance>
          <GlassCard style={styles.heroShell} contentStyle={styles.heroShellInner}>
            <LinearGradient colors={theme.gradients.heroAlt} style={styles.heroGradient}>
              <View style={styles.heroGlowPrimary} />
              <View style={styles.heroGlowSecondary} />

              <View style={styles.heroHeader}>
                <View style={styles.heroBadgeRow}>
                  <View style={styles.heroBadge}>
                    <Text style={styles.heroBadgeText}>Private handoff</Text>
                  </View>
                  <View style={styles.heroStatusPill}>
                    <Ionicons name="checkmark-circle" size={14} color={theme.colors.onTint} />
                    <Text style={styles.heroStatusText}>Proof-first recovery</Text>
                  </View>
                </View>
                <Text style={styles.wordmark}>FindAssure</Text>
              </View>

              <View style={styles.heroMain}>
                <View style={styles.heroCopy}>
                  <Text style={styles.heroTitle}>Recover lost items with more trust.</Text>
                  <Text style={styles.heroBody}>
                    Guided reporting and protected handoff details in one calmer recovery flow.
                  </Text>

                  <View style={styles.heroMetaRow}>
                    <HeroMetaChip icon="camera-outline" text="Photo-led reports" />
                    <HeroMetaChip icon="shield-checkmark-outline" text="Verified release" />
                  </View>
                </View>

                <View style={styles.heroIllustrationWrap}>
                  <AnimatedHeroIllustration size={104} variant="auth" />
                </View>
              </View>
            </LinearGradient>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={70}>
          <View style={styles.primaryTasksSection}>
            <Text style={styles.primaryTasksLabel}>Start here</Text>

            <TaskCard
              icon="scan-outline"
              eyebrow="Report item"
              title="Report an item"
              body="Create a clean found-item report with photos, public details, and verification prompts in one guided flow."
              onPress={handleReportFound}
              tone="accent"
            />

            <TaskCard
              icon="search-outline"
              eyebrow="Item search"
              title="Find a lost item"
              body={
                user
                  ? 'Search with memory, location confidence, description details, and optional image matching.'
                  : 'Search with memory, location confidence, description details, and sign in when you are ready to verify ownership.'
              }
              onPress={handleFindLost}
              tone="neutral"
              helperText={user ? 'Owner tools ready' : 'Login is required before the search flow begins.'}
            />

            {user?.role === 'admin' ? (
              <Pressable style={styles.adminPressable} onPress={handleAdmin}>
                <GlassCard style={styles.adminCard}>
                  <View style={styles.adminIconWrap}>
                    <Ionicons name="shield-checkmark-outline" size={18} color={theme.colors.warning} />
                  </View>
                  <View style={styles.adminCopy}>
                    <Text style={styles.adminTitle}>Admin dashboard</Text>
                    <Text style={styles.adminBody}>Moderation and review tools stay available without competing with the main task area.</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={18} color={theme.colors.textSubtle} />
                </GlassCard>
              </Pressable>
            ) : null}
          </View>
        </StaggeredEntrance>

        <StaggeredEntrance delay={140}>
          <GlassCard style={styles.processCard}>
            <Text style={styles.sectionEyebrow}>Recovery path</Text>
            <Text style={styles.sectionTitle}>One clear flow from report to verified handoff.</Text>
            <View style={styles.processRow}>
              <ProcessStep
                index={1}
                title="Report"
                body="Add photos, public details, and the proof questions only the real owner should know."
              />
              <ProcessStep
                index={2}
                title="Match"
                body="Owners narrow results with location memory, context, and optional photo-based matching."
              />
              <ProcessStep
                index={3}
                title="Verify"
                body="Finder contact stays protected until the answers and claim checks are completed."
              />
            </View>
          </GlassCard>
        </StaggeredEntrance>
      </ScrollView>
    </LinearGradient>
  );
};

const HeroMetaChip = ({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.heroMetaChip}>
      <Ionicons name={icon} size={14} color={theme.colors.onTint} />
      <Text style={styles.heroMetaText}>{text}</Text>
    </View>
  );
};

const TaskCard = ({
  icon,
  eyebrow,
  title,
  body,
  onPress,
  helperText,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  eyebrow: string;
  title: string;
  body: string;
  onPress: () => void;
  helperText?: string;
  tone: 'accent' | 'neutral';
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const accentWrap = tone === 'accent' ? styles.taskIconAccent : styles.taskIconNeutral;
  const accentColor = tone === 'accent' ? theme.colors.accent : theme.colors.textStrong;

  return (
    <Pressable onPress={onPress} style={styles.taskPressable}>
      <GlassCard style={styles.taskCard} contentStyle={styles.taskCardInner}>
        <View style={styles.taskCardTop}>
          <View style={[styles.taskIconWrap, accentWrap]}>
            <Ionicons name={icon} size={20} color={accentColor} />
          </View>
          <Ionicons name="arrow-forward" size={18} color={theme.colors.textSubtle} />
        </View>

        <Text style={styles.taskEyebrow}>{eyebrow}</Text>
        <Text style={styles.taskTitle}>{title}</Text>
        <Text style={styles.taskBody}>{body}</Text>

        <View style={styles.taskFooter}>
          {helperText ? <Text style={styles.taskHelper}>{helperText}</Text> : null}
          <Ionicons name="arrow-forward-circle-outline" size={18} color={theme.colors.textSubtle} />
        </View>
      </GlassCard>
    </Pressable>
  );
};

const ProcessStep = ({
  index,
  title,
  body,
}: {
  index: number;
  title: string;
  body: string;
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.processStep}>
      <View style={styles.processBadge}>
        <Text style={styles.processBadgeText}>{index}</Text>
      </View>
      <Text style={styles.processTitle}>{title}</Text>
      <Text style={styles.processBody}>{body}</Text>
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    content: {
      paddingTop: theme.spacing.sm,
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xxxl,
      gap: theme.spacing.sm,
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
    heroShell: {
      overflow: 'hidden',
      ...theme.shadows.floating,
    },
    heroShellInner: {
      padding: 0,
      overflow: 'hidden',
    },
    heroGradient: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.sm,
      position: 'relative',
      overflow: 'hidden',
    },
    heroGlowPrimary: {
      position: 'absolute',
      width: 180,
      height: 180,
      borderRadius: 90,
      top: -34,
      right: -42,
      backgroundColor: theme.colors.inverse,
      opacity: theme.isDark ? 0.06 : 0.12,
    },
    heroGlowSecondary: {
      position: 'absolute',
      width: 150,
      height: 150,
      borderRadius: 75,
      bottom: -58,
      left: -34,
      backgroundColor: theme.colors.inverse,
      opacity: theme.isDark ? 0.05 : 0.08,
    },
    heroHeader: {
      marginBottom: theme.spacing.sm,
      gap: theme.spacing.xs,
    },
    heroBadgeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      alignItems: 'center',
    },
    heroBadge: {
      alignSelf: 'flex-start',
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      backgroundColor: theme.colors.tintSurface,
      borderWidth: 1,
      borderColor: theme.colors.tintBorder,
    },
    heroBadgeText: {
      ...theme.type.caption,
      color: theme.colors.onTint,
      fontWeight: '700',
    },
    heroStatusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      backgroundColor: theme.colors.tintSurface,
      borderWidth: 1,
      borderColor: theme.colors.tintBorder,
    },
    heroStatusText: {
      ...theme.type.caption,
      color: theme.colors.onTint,
      fontWeight: '700',
    },
    wordmark: {
      ...theme.type.brand,
      color: theme.colors.onTint,
      opacity: 0.94,
    },
    heroMain: {
      gap: theme.spacing.sm,
    },
    heroCopy: {
      gap: theme.spacing.sm,
    },
    heroTitle: {
      ...theme.type.hero,
      color: theme.colors.onTint,
      fontSize: 22,
      lineHeight: 27,
    },
    heroBody: {
      ...theme.type.body,
      color: theme.colors.onTintMuted,
      maxWidth: 520,
      lineHeight: 18,
    },
    heroMetaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.xs,
    },
    heroMetaChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      backgroundColor: theme.colors.tintSurface,
      borderWidth: 1,
      borderColor: theme.colors.tintBorder,
    },
    heroMetaText: {
      ...theme.type.caption,
      color: theme.colors.onTint,
      fontWeight: '700',
    },
    heroIllustrationWrap: {
      alignSelf: 'center',
      paddingTop: theme.spacing.xs,
    },
    primaryTasksSection: {
      gap: theme.spacing.sm,
    },
    primaryTasksLabel: {
      ...theme.type.label,
      color: theme.colors.textSubtle,
      marginBottom: 2,
    },
    taskPressable: {
      width: '100%',
    },
    taskCard: {
      borderWidth: 1.5,
      borderColor: theme.colors.borderStrong,
      borderRadius: theme.radius.xl,
      ...theme.shadows.soft,
    },
    taskCardInner: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    taskCardTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.sm,
    },
    taskIconWrap: {
      width: 54,
      height: 54,
      borderRadius: 27,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
    },
    taskIconAccent: {
      backgroundColor: theme.colors.accentSoft,
      borderColor: theme.colors.borderStrong,
    },
    taskIconNeutral: {
      backgroundColor: theme.colors.cardMuted,
      borderColor: theme.colors.border,
    },
    taskEyebrow: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    taskTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: 4,
      fontSize: 20,
      lineHeight: 24,
    },
    taskBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.md,
      lineHeight: 19,
    },
    taskFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.xs,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    taskHelper: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
      flex: 1,
      fontSize: 12,
      lineHeight: 16,
    },
    adminPressable: {
      width: '100%',
    },
    sectionEyebrow: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    sectionTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      flexShrink: 1,
    },
    adminCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      ...theme.shadows.soft,
    },
    adminIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.warningSoft,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
    },
    adminCopy: {
      flex: 1,
    },
    adminTitle: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      marginBottom: 2,
    },
    adminBody: {
      ...theme.type.caption,
      color: theme.colors.textMuted,
    },
    processCard: {
      ...theme.shadows.soft,
    },
    processRow: {
      marginTop: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    processStep: {
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.cardMuted,
      padding: theme.spacing.md,
    },
    processBadge: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing.sm,
    },
    processBadgeText: {
      ...theme.type.caption,
      color: theme.colors.onTint,
      fontWeight: '800',
    },
    processTitle: {
      ...theme.type.cardTitle,
      color: theme.colors.textStrong,
      marginBottom: 4,
    },
    processBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
  });

export default HomeScreen;
