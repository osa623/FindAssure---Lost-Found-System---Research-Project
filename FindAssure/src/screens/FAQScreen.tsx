import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../context/ThemeContext';
import { GlassCard } from '../components/GlassCard';

const FAQ_ITEMS = [
  {
    question: 'How do I report a found item?',
    answer:
      'Open the founder flow from the home screen, add clear photos, confirm the category and description, choose verification questions, then submit the location and your contact details.',
  },
  {
    question: 'Why do I need to answer questions to claim an item?',
    answer:
      'Verification questions help prevent false claims. Finder contact details stay private until the owner provides enough evidence to prove the item is really theirs.',
  },
  {
    question: 'Why can’t I see the finder’s contact immediately?',
    answer:
      'Contact details are protected to avoid spam and fraudulent claims. The app only reveals them after the ownership check passes.',
  },
  {
    question: 'Can I search without signing in?',
    answer:
      'You can browse the home experience without an account, but starting a real owner search and any claim workflow requires a signed-in owner account.',
  },
  {
    question: 'What should I do if the category feels wrong?',
    answer:
      'Choose the closest category and use the description field to add specifics like brand, material, color, or distinguishing marks. That extra context matters more than a perfect label.',
  },
  {
    question: 'How many photos should I upload?',
    answer:
      'One clear image is enough to begin, but multiple angles usually help the system and the finder compare distinctive details more accurately.',
  },
  {
    question: 'What happens if my verification stays pending?',
    answer:
      'Pending means the submission needs review or more time to process. Keep notifications on and check back in the app for the final result.',
  },
];

const FAQScreen = () => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GlassCard style={styles.introCard}>
          <Text style={styles.introEyebrow}>Help</Text>
          <Text style={styles.introTitle}>Frequently asked questions</Text>
          <Text style={styles.introBody}>
            Quick answers about reporting, searching, and how verification protects both owners and finders.
          </Text>
        </GlassCard>

        {FAQ_ITEMS.map((item, index) => {
          const open = openIndex === index;
          return (
            <GlassCard key={item.question} style={styles.itemCard}>
              <Pressable style={styles.itemHeader} onPress={() => setOpenIndex(open ? null : index)}>
                <Text style={styles.itemQuestion}>{item.question}</Text>
                <Ionicons
                  name={open ? 'remove-circle-outline' : 'add-circle-outline'}
                  size={20}
                  color={theme.colors.accent}
                />
              </Pressable>
              {open ? <Text style={styles.itemAnswer}>{item.answer}</Text> : null}
            </GlassCard>
          );
        })}
      </ScrollView>
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
    },
    introCard: {
      marginBottom: theme.spacing.md,
    },
    introEyebrow: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    introTitle: {
      ...theme.type.section,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.xs,
    },
    introBody: {
      ...theme.type.body,
      color: theme.colors.textMuted,
    },
    itemCard: {
      marginBottom: theme.spacing.sm,
    },
    itemHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
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
    },
  });

export default FAQScreen;
