import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FormInput } from '../components/FormInput';
import { GlassCard } from '../components/GlassCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { StaggeredEntrance } from '../components/StaggeredEntrance';
import { useAuth } from '../context/AuthContext';
import { useAppTheme } from '../context/ThemeContext';
import { RootStackParamList } from '../types/models';

type FAQNavigationProp = StackNavigationProp<RootStackParamList, 'FAQ'>;
type FAQCategory = 'All' | 'Reporting' | 'Search' | 'Verification' | 'Access' | 'Privacy';

interface FAQItem {
  question: string;
  answer: string;
  category: Exclude<FAQCategory, 'All'>;
  keywords: string[];
}

const FAQ_CATEGORIES: FAQCategory[] = ['All', 'Reporting', 'Search', 'Verification', 'Access', 'Privacy'];

const FAQ_ITEMS: FAQItem[] = [
  {
    category: 'Reporting',
    question: 'How do I report a found item?',
    answer:
      'Open the report item screen from the home screen, add clear photos, confirm the category and description, choose verification questions, then submit the location and your contact details.',
    keywords: ['founder', 'report', 'submit', 'photos', 'location'],
  },
  {
    category: 'Reporting',
    question: 'What should I do if the category feels wrong?',
    answer:
      'Choose the closest category and use the description field to add specifics like brand, material, color, or distinguishing marks. That extra context matters more than a perfect label.',
    keywords: ['category', 'label', 'description', 'brand'],
  },
  {
    category: 'Search',
    question: 'Can I search without signing in?',
    answer:
      'You can browse the home experience without an account, but starting a real owner search and any claim workflow requires a signed-in owner account.',
    keywords: ['guest', 'login', 'owner', 'account'],
  },
  {
    category: 'Search',
    question: 'How many photos should I upload?',
    answer:
      'One clear image is enough to begin, but multiple angles usually help the system and the finder compare distinctive details more accurately.',
    keywords: ['photo', 'image', 'upload', 'angles'],
  },
  {
    category: 'Verification',
    question: 'Why do I need to answer questions to claim an item?',
    answer:
      'Verification questions help prevent false claims. Finder contact details stay private until the owner provides enough evidence to prove the item is really theirs.',
    keywords: ['claim', 'questions', 'proof', 'owner'],
  },
  {
    category: 'Verification',
    question: 'What happens if my verification stays pending?',
    answer:
      'Pending means the submission needs review or more time to process. Keep notifications on and check back in the app for the final result.',
    keywords: ['pending', 'review', 'result'],
  },
  {
    category: 'Access',
    question: 'How do I manage my account or theme preferences?',
    answer:
      'Open Settings to change appearance, reach the FAQ, check your session state, and navigate to Profile or Admin tools when those options are available to your account.',
    keywords: ['settings', 'profile', 'theme', 'admin'],
  },
  {
    category: 'Privacy',
    question: 'Why can’t I see the finder’s contact immediately?',
    answer:
      'Contact details are protected to avoid spam and fraudulent claims. The app only reveals them after the ownership check passes.',
    keywords: ['contact', 'private', 'finder', 'privacy'],
  },
];

const FAQScreen = () => {
  const navigation = useNavigation<FAQNavigationProp>();
  const { user } = useAuth();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<FAQCategory>('All');
  const [openQuestions, setOpenQuestions] = useState<Record<string, boolean>>({
    [FAQ_ITEMS[0].question]: true,
  });

  const normalizedQuery = query.trim().toLowerCase();

  const filteredItems = useMemo(() => {
    return FAQ_ITEMS.filter((item) => {
      const categoryMatch = activeCategory === 'All' || item.category === activeCategory;
      if (!categoryMatch) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [item.question, item.answer, item.category, ...item.keywords].join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [activeCategory, normalizedQuery]);

  const toggleOpen = (question: string) => {
    setOpenQuestions((current) => ({
      ...current,
      [question]: !current[question],
    }));
  };

  return (
    <LinearGradient colors={theme.gradients.appBackground} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <StaggeredEntrance>
          <GlassCard style={styles.heroShell} contentStyle={styles.heroShellInner}>
            <LinearGradient colors={theme.gradients.heroAlt} style={styles.heroCard}>
              <View style={styles.heroGlowPrimary} />
              <View style={styles.heroGlowSecondary} />

              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>Help center</Text>
              </View>
              <Text style={styles.heroTitle}>Find answers faster.</Text>
              <Text style={styles.heroBody}>Search local help for reporting, search, verification, access, and privacy.</Text>

              <View style={styles.heroMetaRow}>
                <HeroStat icon="search-outline" text="Search local help" />
                <HeroStat icon="layers-outline" text="Filter by topic" />
              </View>
            </LinearGradient>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={70}>
          <GlassCard style={styles.searchCard}>
            <FormInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search help articles"
              leadingIcon="search-outline"
              trailing={
                query ? (
                  <Pressable onPress={() => setQuery('')}>
                    <Ionicons name="close-circle" size={18} color={theme.colors.textSubtle} />
                  </Pressable>
                ) : undefined
              }
            />

            <View style={styles.categoryRow}>
              {FAQ_CATEGORIES.map((category) => {
                const selected = category === activeCategory;
                return (
                  <Pressable
                    key={category}
                    style={[styles.categoryChip, selected && styles.categoryChipSelected]}
                    onPress={() => setActiveCategory(category)}
                  >
                    <Text style={[styles.categoryChipText, selected && styles.categoryChipTextSelected]}>{category}</Text>
                  </Pressable>
                );
              })}
            </View>
          </GlassCard>
        </StaggeredEntrance>

        <StaggeredEntrance delay={120}>
          <View style={styles.resultsHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>Questions</Text>
              <Text style={styles.sectionTitle}>
                {filteredItems.length === 0 ? 'No matching help articles.' : 'Browse the matching answers.'}
              </Text>
            </View>
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{filteredItems.length}</Text>
            </View>
          </View>
        </StaggeredEntrance>

        <StaggeredEntrance delay={170}>
          {filteredItems.length === 0 ? (
            <GlassCard style={styles.emptyCard}>
              <Ionicons name="search-outline" size={24} color={theme.colors.textSubtle} />
              <Text style={styles.emptyTitle}>No results found</Text>
              <Text style={styles.emptyBody}>Try a broader keyword or switch back to All categories.</Text>
              <PrimaryButton
                title="Clear filters"
                onPress={() => {
                  setQuery('');
                  setActiveCategory('All');
                }}
                variant="secondary"
              />
            </GlassCard>
          ) : (
            filteredItems.map((item) => {
              const open = Boolean(openQuestions[item.question]);
              return (
                <GlassCard key={item.question} style={styles.itemCard}>
                  <Pressable style={styles.itemHeader} onPress={() => toggleOpen(item.question)}>
                    <View style={styles.itemHeaderCopy}>
                      <View style={styles.itemMetaRow}>
                        <View style={styles.inlineCategory}>
                          <Text style={styles.inlineCategoryText}>{item.category}</Text>
                        </View>
                      </View>
                      <Text style={styles.itemQuestion}>{item.question}</Text>
                    </View>
                    <Ionicons
                      name={open ? 'remove-circle-outline' : 'add-circle-outline'}
                      size={20}
                      color={theme.colors.accent}
                    />
                  </Pressable>
                  {open ? <Text style={styles.itemAnswer}>{item.answer}</Text> : null}
                </GlassCard>
              );
            })
          )}
        </StaggeredEntrance>

        <StaggeredEntrance delay={220}>
          <GlassCard style={styles.footerCard}>
            <Text style={styles.sectionEyebrow}>Next steps</Text>
            <Text style={styles.sectionTitle}>Still need help?</Text>
            <Text style={styles.sectionBody}>
              Open Settings for app controls, or head to your account area for profile and session actions.
            </Text>
            <View style={styles.footerActions}>
              <PrimaryButton title="Open Settings" onPress={() => navigation.navigate('Settings')} variant="secondary" />
              <PrimaryButton
                title={user ? 'Open Profile' : 'Login / Register'}
                onPress={() => navigation.navigate(user ? 'Profile' : 'Login')}
                variant="ghost"
              />
            </View>
          </GlassCard>
        </StaggeredEntrance>
      </ScrollView>
    </LinearGradient>
  );
};

const HeroStat = ({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.heroStat}>
      <Ionicons name={icon} size={14} color={theme.colors.onTint} />
      <Text style={styles.heroStatText}>{text}</Text>
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xxxl,
      gap: theme.spacing.md,
    },
    heroShell: {
      overflow: 'hidden',
      ...theme.shadows.floating,
    },
    heroShellInner: {
      padding: 0,
      overflow: 'hidden',
    },
    heroCard: {
      padding: theme.spacing.lg,
      position: 'relative',
      overflow: 'hidden',
    },
    heroGlowPrimary: {
      position: 'absolute',
      width: 176,
      height: 176,
      borderRadius: 88,
      top: -34,
      right: -40,
      backgroundColor: theme.colors.inverse,
      opacity: theme.isDark ? 0.06 : 0.12,
    },
    heroGlowSecondary: {
      position: 'absolute',
      width: 138,
      height: 138,
      borderRadius: 69,
      bottom: -46,
      left: -20,
      backgroundColor: theme.colors.inverse,
      opacity: theme.isDark ? 0.05 : 0.08,
    },
    heroBadge: {
      alignSelf: 'flex-start',
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      marginBottom: theme.spacing.md,
      backgroundColor: theme.colors.tintSurface,
      borderWidth: 1,
      borderColor: theme.colors.tintBorder,
    },
    heroBadgeText: {
      ...theme.type.caption,
      color: theme.colors.onTint,
      fontWeight: '700',
    },
    heroTitle: {
      ...theme.type.title,
      color: theme.colors.onTint,
      marginBottom: theme.spacing.sm,
      maxWidth: '90%',
    },
    heroBody: {
      ...theme.type.body,
      color: theme.colors.onTintMuted,
      maxWidth: '92%',
    },
    heroMetaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.lg,
    },
    heroStat: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 7,
      backgroundColor: theme.colors.tintSurface,
      borderWidth: 1,
      borderColor: theme.colors.tintBorder,
    },
    heroStatText: {
      ...theme.type.caption,
      color: theme.colors.onTint,
      fontWeight: '700',
    },
    searchCard: {
      ...theme.shadows.soft,
    },
    categoryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
    },
    categoryChip: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 7,
      backgroundColor: theme.colors.cardMuted,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    categoryChipSelected: {
      backgroundColor: theme.colors.accentSoft,
      borderColor: theme.colors.accent,
    },
    categoryChipText: {
      ...theme.type.caption,
      color: theme.colors.textStrong,
      fontWeight: '700',
    },
    categoryChipTextSelected: {
      color: theme.colors.accent,
    },
    resultsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
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
      marginTop: theme.spacing.xs,
    },
    countPill: {
      minWidth: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.accentSoft,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
    },
    countPillText: {
      ...theme.type.caption,
      color: theme.colors.accent,
      fontWeight: '800',
    },
    emptyCard: {
      gap: theme.spacing.sm,
      alignItems: 'center',
      paddingVertical: theme.spacing.xxl,
    },
    emptyTitle: {
      ...theme.type.cardTitle,
      color: theme.colors.textStrong,
    },
    emptyBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      textAlign: 'center',
      marginBottom: theme.spacing.sm,
    },
    itemCard: {
      marginBottom: theme.spacing.sm,
    },
    itemHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    itemHeaderCopy: {
      flex: 1,
    },
    itemMetaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
    },
    inlineCategory: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      backgroundColor: theme.colors.accentSoft,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
    },
    inlineCategoryText: {
      ...theme.type.caption,
      color: theme.colors.accent,
      fontWeight: '700',
    },
    itemQuestion: {
      ...theme.type.bodyStrong,
      color: theme.colors.textStrong,
      flex: 1,
    },
    itemAnswer: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      marginTop: theme.spacing.sm,
      paddingTop: theme.spacing.sm,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    footerCard: {
      ...theme.shadows.soft,
    },
    footerActions: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
    },
  });

export default FAQScreen;
