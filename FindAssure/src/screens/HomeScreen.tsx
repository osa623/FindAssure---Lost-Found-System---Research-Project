import React, { useLayoutEffect } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CommonActions, useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/AuthContext';
import { RootStackParamList } from '../types/models';
import { GlassCard } from '../components/GlassCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { gradients, palette, radius, spacing, type } from '../theme/designSystem';

type HomeScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Home'>;

const HomeScreen = () => {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { user } = useAuth();

  const handleProfile = () => navigation.navigate('Profile');
  const handleLogin = () => navigation.navigate('Login');
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
      title: '',
      headerRight: () => (
        <Pressable onPress={() => (user ? handleProfile() : handleLogin())} style={styles.headerButton}>
          <Ionicons name={user ? 'person-circle' : 'log-in'} size={24} color={palette.ink} />
        </Pressable>
      ),
    });
  }, [navigation, user]);

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
    <LinearGradient colors={gradients.appBackground} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Animated.View entering={FadeInDown.duration(420)}>
          <GlassCard style={styles.hero}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>iOS-style lost and found</Text>
            </View>
            <View style={styles.heroTop}>
              <Text style={styles.wordmark}>FIND ASSURE</Text>
            </View>
            <Text style={styles.heroTitle}>Recover faster. Report cleaner. Verify safely.</Text>
            <Text style={styles.heroBody}>
              A calmer lost-and-found workflow with better photos, clearer context, and controlled access to finder details.
            </Text>
            <View style={styles.heroActions}>
              <PrimaryButton title="Report Found Item" onPress={handleReportFound} />
              <PrimaryButton title="Find Lost Item" onPress={handleFindLost} variant="secondary" />
            </View>
          </GlassCard>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(80).duration(420)}>
          <GlassCard style={styles.accountCard}>
            {user ? (
              <>
                <Text style={styles.sectionEyebrow}>Account</Text>
                <Text style={styles.sectionTitle}>Welcome back, {user.name.split(' ')[0]}.</Text>
                <Text style={styles.sectionBody}>
                  Your current role is {user.role}. Continue where you left off or review your account details.
                </Text>
                <View style={styles.inlineActions}>
                  <PrimaryButton title="Open Profile" onPress={handleProfile} variant="secondary" />
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
                  Reporting found items is open. Searching and claiming requires a signed-in owner account.
                </Text>
                <PrimaryButton title="Login / Register" onPress={handleLogin} variant="secondary" />
              </>
            )}
          </GlassCard>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(140).duration(420)} style={styles.stack}>
          <ActionPanel
            icon="scan-outline"
            eyebrow="Founder flow"
            title="Create a report with layered proof"
            body="Capture up to three images, refine the description, choose five owner questions, then submit finder contact details privately."
            onPress={handleReportFound}
          />
          <ActionPanel
            icon="locate-outline"
            eyebrow="Owner flow"
            title="Search with location confidence and photo evidence"
            body={`Look through reported items using description, place, and optional images.${user ? '' : ' Login is required before search.'}`}
            onPress={handleFindLost}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(200).duration(420)}>
          <GlassCard style={styles.howItWorks}>
            <Text style={styles.sectionEyebrow}>How it works</Text>
            <Text style={styles.sectionTitle}>One flow for reporting. One flow for proving ownership.</Text>
            <View style={styles.steps}>
              {[
                'Founders submit photos, context, and verification questions.',
                'Owners search using details, location confidence, and optional photos.',
                'Verification gates access to finder contact details.',
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
    </LinearGradient>
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
}) => (
  <Pressable onPress={onPress}>
    <GlassCard style={styles.actionCard}>
      <View style={styles.actionHeader}>
        <View style={styles.actionIconWrap}>
          <Ionicons name={icon} size={22} color={palette.primaryDeep} />
        </View>
        <Ionicons name="arrow-forward" size={18} color={palette.mist} />
      </View>
      <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
      <Text style={styles.actionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{body}</Text>
    </GlassCard>
  </Pressable>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.paperStrong,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  hero: {
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: palette.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    marginBottom: spacing.md,
  },
  heroBadgeText: {
    ...type.caption,
    color: palette.primaryDeep,
    fontWeight: '700',
  },
  heroTop: {
    marginBottom: spacing.xs,
  },
  wordmark: {
    ...type.brand,
    color: palette.primaryDeep,
  },
  heroTitle: {
    ...type.title,
    color: palette.ink,
    marginBottom: spacing.sm,
  },
  heroBody: {
    ...type.body,
    color: palette.inkSoft,
    marginBottom: spacing.lg,
  },
  heroActions: {
    gap: spacing.sm,
  },
  accountCard: {
    marginTop: 0,
  },
  stack: {
    gap: spacing.md,
  },
  actionCard: {
    borderRadius: radius.lg,
  },
  actionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  actionIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: palette.primarySoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionEyebrow: {
    ...type.label,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    ...type.section,
    marginBottom: spacing.sm,
  },
  actionTitle: {
    ...type.section,
    marginBottom: spacing.xs,
  },
  sectionBody: {
    ...type.body,
  },
  inlineActions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  howItWorks: {
    marginTop: spacing.xs,
  },
  steps: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  stepBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    ...type.caption,
    color: palette.paperStrong,
    fontWeight: '800',
  },
  stepText: {
    ...type.body,
    flex: 1,
  },
});

export default HomeScreen;
