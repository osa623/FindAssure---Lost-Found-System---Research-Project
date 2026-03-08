import React, { useMemo, useRef, useState } from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Animated, {
  interpolate,
  SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { GlassCard } from '../components/GlassCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAppTheme } from '../context/ThemeContext';
import { RootStackParamList } from '../types/models';

const { width } = Dimensions.get('window');
const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<any>);

type OnboardingNavigationProp = StackNavigationProp<RootStackParamList, 'Onboarding'>;

interface OnboardingSlide {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  badge: string;
  gradient: readonly [string, string, string];
}

const SlideCard = ({
  item,
  index,
  scrollX,
}: {
  item: OnboardingSlide;
  index: number;
  scrollX: SharedValue<number>;
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const animatedStyle = useAnimatedStyle(() => {
    const position = scrollX.value / width;
    return {
      transform: [
        { translateY: interpolate(position, [index - 1, index, index + 1], [24, 0, 24]) },
        { scale: interpolate(position, [index - 1, index, index + 1], [0.94, 1, 0.94]) },
      ],
      opacity: interpolate(position, [index - 1, index, index + 1], [0.4, 1, 0.4]),
    };
  });

  return (
    <View style={styles.slide}>
      <Animated.View style={[styles.slideInner, animatedStyle]}>
        <LinearGradient colors={item.gradient} style={styles.heroPanel}>
          <View style={styles.heroTopRow}>
            <Text style={styles.badge}>{item.badge}</Text>
            <Text style={styles.wordmark}>FIND ASSURE</Text>
          </View>
          <View style={styles.orb} />
          <Text style={styles.eyebrow}>{item.eyebrow}</Text>
          <Text style={styles.heroTitle}>{item.title}</Text>
        </LinearGradient>

        <GlassCard style={styles.copyCard}>
          <Text style={styles.copyText}>{item.description}</Text>
          <View style={styles.copyMetaRow}>
            <Text style={styles.copyMeta}>iOS-first</Text>
            <Text style={styles.copyMeta}>AI assisted</Text>
            <Text style={styles.copyMeta}>Private by default</Text>
          </View>
        </GlassCard>
      </Animated.View>
    </View>
  );
};

const OnboardingScreen = () => {
  const navigation = useNavigation<OnboardingNavigationProp>();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useSharedValue(0);

  const slides = useMemo<OnboardingSlide[]>(
    () => [
      {
        id: '1',
        eyebrow: 'FindAssure',
        title: 'Lost and found, rebuilt for speed.',
        description:
          'A calmer reporting and recovery experience with AI-assisted matching, cleaner verification, and clearer next steps.',
        badge: '01',
        gradient: theme.gradients.hero,
      },
      {
        id: '2',
        eyebrow: 'Report item',
        title: 'Capture, describe, and protect the item.',
        description:
          'Add strong photos, let the app prepare details, and choose the five questions that only the real owner should know.',
        badge: '02',
        gradient: theme.gradients.violet,
      },
      {
        id: '3',
        eyebrow: 'Item search',
        title: 'Search with context, not guesswork.',
        description:
          'Combine category, description, location confidence, and optional photos to surface stronger matches immediately.',
        badge: '03',
        gradient: theme.gradients.heroAlt,
      },
      {
        id: '4',
        eyebrow: 'Verification',
        title: 'Ownership stays private until it is proven.',
        description:
          'Video and semantic checks keep sensitive finder contact details hidden until the claim is verified.',
        badge: '04',
        gradient: theme.gradients.success,
      },
    ],
    [theme.gradients.hero, theme.gradients.heroAlt, theme.gradients.success, theme.gradients.violet]
  );

  const completeOnboarding = async () => {
    try {
      await AsyncStorage.setItem('hasSeenOnboarding', 'true');
      navigation.replace('Home');
    } catch {
      navigation.replace('Home');
    }
  };

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      const nextIndex = currentIndex + 1;
      flatListRef.current?.scrollToIndex({ index: nextIndex });
      setCurrentIndex(nextIndex);
      return;
    }
    completeOnboarding();
  };

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });

  return (
    <LinearGradient colors={theme.gradients.appBackground} style={styles.container}>
      <View style={styles.topBar}>
        <Pressable onPress={completeOnboarding}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>

      <AnimatedFlatList
        ref={flatListRef}
        data={slides}
        renderItem={({ item, index }) => <SlideCard item={item} index={index} scrollX={scrollX} />}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(event) => {
          const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
          setCurrentIndex(nextIndex);
        }}
      />

      <View style={styles.footer}>
        <View style={styles.pagination}>
          {slides.map((slide, index) => (
            <View key={slide.id} style={[styles.dot, index === currentIndex && styles.dotActive]} />
          ))}
        </View>
        <PrimaryButton
          title={currentIndex === slides.length - 1 ? 'Enter FindAssure' : 'Continue'}
          onPress={handleNext}
          size="lg"
        />
      </View>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    topBar: {
      paddingTop: 72,
      paddingHorizontal: theme.spacing.xl,
      alignItems: 'flex-end',
    },
    skipText: {
      ...theme.type.bodyStrong,
      color: theme.colors.accent,
    },
    slide: {
      width,
      paddingHorizontal: theme.spacing.xl,
      paddingTop: theme.spacing.md,
    },
    slideInner: {
      flex: 1,
    },
    heroPanel: {
      flex: 1,
      minHeight: 420,
      borderRadius: theme.radius.xl,
      padding: theme.spacing.xl,
      overflow: 'hidden',
      justifyContent: 'flex-end',
    },
    heroTopRow: {
      position: 'absolute',
      top: theme.spacing.xl,
      left: theme.spacing.xl,
      right: theme.spacing.xl,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    badge: {
      ...theme.type.bodyStrong,
      color: theme.colors.paperStrong,
      opacity: 0.9,
    },
    wordmark: {
      ...theme.type.brand,
      fontSize: 14,
      lineHeight: 16,
      color: theme.colors.paperStrong,
    },
    orb: {
      position: 'absolute',
      top: -36,
      right: -12,
      width: 188,
      height: 188,
      borderRadius: 94,
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.18)',
    },
    eyebrow: {
      ...theme.type.label,
      color: 'rgba(255,255,255,0.72)',
      marginBottom: theme.spacing.sm,
    },
    heroTitle: {
      ...theme.type.hero,
      maxWidth: '92%',
    },
    copyCard: {
      marginTop: -56,
      marginHorizontal: theme.spacing.md,
    },
    copyText: {
      ...theme.type.body,
      color: theme.colors.textStrong,
      marginBottom: theme.spacing.lg,
    },
    copyMetaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    copyMeta: {
      ...theme.type.caption,
      color: theme.colors.accent,
      backgroundColor: theme.colors.accentSoft,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      borderRadius: theme.radius.pill,
      overflow: 'hidden',
    },
    footer: {
      paddingHorizontal: theme.spacing.xl,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
    },
    pagination: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      justifyContent: 'center',
      marginBottom: theme.spacing.lg,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: theme.colors.accentSoft,
    },
    dotActive: {
      width: 28,
      backgroundColor: theme.colors.accent,
    },
  });

export default OnboardingScreen;
