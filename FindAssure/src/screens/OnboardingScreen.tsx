import React, { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  interpolate,
  SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { RootStackParamList } from '../types/models';
import { GlassCard } from '../components/GlassCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { gradients, palette, radius, spacing, type } from '../theme/designSystem';

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

const slides: OnboardingSlide[] = [
  {
    id: '1',
    eyebrow: 'FindAssure',
    title: 'Lost and found, rebuilt for speed.',
    description: 'A calmer reporting and recovery experience with AI-assisted matching, cleaner verification, and clearer next steps.',
    badge: '01',
    gradient: gradients.hero,
  },
  {
    id: '2',
    eyebrow: 'Founder flow',
    title: 'Capture, describe, and protect the item.',
    description: 'Add strong photos, let the app prepare details, and choose the five questions that only the real owner should know.',
    badge: '02',
    gradient: gradients.violet,
  },
  {
    id: '3',
    eyebrow: 'Owner flow',
    title: 'Search with context, not guesswork.',
    description: 'Combine category, description, location confidence, and optional photos to surface stronger matches immediately.',
    badge: '03',
    gradient: gradients.heroAlt,
  },
  {
    id: '4',
    eyebrow: 'Verification',
    title: 'Ownership stays private until it is proven.',
    description: 'Video and semantic checks keep sensitive finder contact details hidden until the claim is verified.',
    badge: '04',
    gradient: gradients.success,
  },
];

const SlideCard = ({
  item,
  index,
  scrollX,
}: {
  item: OnboardingSlide;
  index: number;
  scrollX: SharedValue<number>;
}) => {
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useSharedValue(0);

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
    <LinearGradient colors={gradients.appBackground} style={styles.container}>
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
          {slides.map((_, index) => (
            <View key={index} style={[styles.dot, index === currentIndex && styles.dotActive]} />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.paper,
  },
  topBar: {
    paddingTop: 72,
    paddingHorizontal: spacing.xl,
    alignItems: 'flex-end',
  },
  skipText: {
    ...type.bodyStrong,
    color: palette.primaryDeep,
  },
  slide: {
    width,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  slideInner: {
    flex: 1,
  },
  heroPanel: {
    flex: 1,
    minHeight: 420,
    borderRadius: radius.xl,
    padding: spacing.xl,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  heroTopRow: {
    position: 'absolute',
    top: spacing.xl,
    left: spacing.xl,
    right: spacing.xl,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  badge: {
    ...type.bodyStrong,
    color: palette.paperStrong,
    opacity: 0.9,
  },
  wordmark: {
    ...type.brand,
    fontSize: 14,
    lineHeight: 16,
    color: palette.paperStrong,
  },
  orb: {
    position: 'absolute',
    top: -36,
    right: -12,
    width: 188,
    height: 188,
    borderRadius: 94,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  eyebrow: {
    ...type.label,
    color: 'rgba(255,255,255,0.72)',
    marginBottom: spacing.sm,
  },
  heroTitle: {
    ...type.hero,
    maxWidth: '92%',
  },
  copyCard: {
    marginTop: -56,
    marginHorizontal: spacing.md,
  },
  copyText: {
    ...type.body,
    color: palette.ink,
    marginBottom: spacing.lg,
  },
  copyMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  copyMeta: {
    ...type.caption,
    color: palette.primaryDeep,
    backgroundColor: palette.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  pagination: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(79,124,255,0.18)',
  },
  dotActive: {
    width: 28,
    backgroundColor: palette.primary,
  },
});

export default OnboardingScreen;
