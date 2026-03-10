import React, { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  SharedValue,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { OnboardingIllustration, OnboardingIllustrationVariant } from '../components/OnboardingIllustration';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAppTheme } from '../context/ThemeContext';
import { RootStackParamList } from '../types/models';

type OnboardingNavigationProp = StackNavigationProp<RootStackParamList, 'Onboarding'>;

interface OnboardingSlide {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  highlights: string[];
  illustrationVariant: OnboardingIllustrationVariant;
  accent?: string;
}

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<OnboardingSlide>);

const SlideCard = ({
  bottomInset,
  index,
  isLast,
  item,
  onAdvance,
  pageWidth,
  scrollX,
  topInset,
  totalSlides,
}: {
  bottomInset: number;
  index: number;
  isLast: boolean;
  item: OnboardingSlide;
  onAdvance: () => void;
  pageWidth: number;
  scrollX: SharedValue<number>;
  topInset: number;
  totalSlides: number;
}) => {
  const { theme } = useAppTheme();
  const compact = useWindowDimensions().height < 780;
  const styles = useMemo(() => createStyles(theme, compact), [theme, compact]);

  const copyStyle = useAnimatedStyle(() => {
    const position = scrollX.value / pageWidth;
    return {
      opacity: interpolate(position, [index - 1, index, index + 1], [0.36, 1, 0.36]),
      transform: [
        { translateY: interpolate(position, [index - 1, index, index + 1], [18, 0, 18]) },
      ],
    };
  });

  return (
    <View style={[styles.slide, { width: pageWidth }]}>
      <View style={[styles.slideInner, { paddingTop: topInset + 76 }]}>
        <View style={styles.visualZone}>
          <View style={styles.visualMeta}>
            <View style={styles.sectionPill}>
              <Text style={styles.sectionPillText}>{item.eyebrow}</Text>
            </View>
            <Text style={styles.sectionIndex}>{`0${index + 1}`}</Text>
          </View>

          <OnboardingIllustration
            accent={item.accent}
            index={index}
            pageWidth={pageWidth}
            scrollX={scrollX}
            variant={item.illustrationVariant}
          />
        </View>

        <Animated.View style={[styles.sheet, copyStyle, { paddingBottom: bottomInset + 6 }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetEyebrow}>{item.eyebrow}</Text>
          <Text style={styles.sheetTitle}>{item.title}</Text>
          <Text style={styles.sheetDescription}>{item.description}</Text>

          <View style={styles.highlightRow}>
            {item.highlights.map((highlight) => (
              <View key={highlight} style={styles.highlightChip}>
                <Text style={styles.highlightText}>{highlight}</Text>
              </View>
            ))}
          </View>

          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              {Array.from({ length: totalSlides }).map((_, progressIndex) => (
                <View
                  key={`${item.id}-${progressIndex}`}
                  style={[
                    styles.progressSegment,
                    progressIndex <= index && styles.progressSegmentActive,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.progressLabel}>{`${index + 1}/${totalSlides}`}</Text>
          </View>

          <PrimaryButton
            onPress={onAdvance}
            size="lg"
            style={styles.cta}
            title={isLast ? 'Enter FindAssure' : 'Continue'}
          />
        </Animated.View>
      </View>
    </View>
  );
};

const OnboardingScreen = () => {
  const navigation = useNavigation<OnboardingNavigationProp>();
  const { theme } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = height < 780;
  const styles = useMemo(() => createStyles(theme, compact), [theme, compact]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList<OnboardingSlide>>(null);
  const scrollX = useSharedValue(0);

  const slides = useMemo<OnboardingSlide[]>(
    () => [
      {
        id: 'report',
        eyebrow: 'Report faster',
        title: 'Capture the item once, then let the flow guide the recovery details.',
        description:
          'Snap the item, confirm the AI-prepared summary, and keep the owner-only answers private from the start.',
        highlights: ['Quick photo intake', 'AI detail draft', 'Owner-only questions'],
        illustrationVariant: 'report',
        accent: 'Camera-led intake',
      },
      {
        id: 'search',
        eyebrow: 'Search smarter',
        title: 'Use context-rich matching instead of broad guesswork.',
        description:
          'Blend photos, description clues, and last-seen context to surface stronger recovery matches sooner.',
        highlights: ['Photo-aware search', 'Location signal', 'Confidence-led results'],
        illustrationVariant: 'search',
        accent: 'Signal-first search',
      },
      {
        id: 'verify',
        eyebrow: 'Verify privately',
        title: 'Keep finder details hidden until the right owner is proven.',
        description:
          'Video and semantic checks protect contact details and only unlock the handoff after real proof.',
        highlights: ['Protected contact info', 'Video verification', 'Proof before release'],
        illustrationVariant: 'verify',
        accent: 'Private release',
      },
    ],
    []
  );

  const bottomInset = Math.max(insets.bottom, theme.spacing.lg);

  const completeOnboarding = async () => {
    try {
      await AsyncStorage.setItem('hasSeenOnboarding', 'true');
      navigation.replace('Home');
    } catch {
      navigation.replace('Home');
    }
  };

  const goToIndex = (nextIndex: number) => {
    flatListRef.current?.scrollToIndex({ animated: true, index: nextIndex });
    setCurrentIndex(nextIndex);
  };

  const handleAdvance = () => {
    if (currentIndex < slides.length - 1) {
      goToIndex(currentIndex + 1);
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
      <View style={[styles.topBar, { paddingTop: insets.top + theme.spacing.sm }]}>
        <Text style={styles.wordmark}>FindAssure</Text>
        <Pressable hitSlop={10} onPress={completeOnboarding}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>

      <AnimatedFlatList
        ref={flatListRef}
        bounces={false}
        data={slides}
        decelerationRate="fast"
        horizontal
        keyExtractor={(item) => item.id}
        onMomentumScrollEnd={(event) => {
          const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
          setCurrentIndex(nextIndex);
        }}
        onScroll={scrollHandler}
        pagingEnabled
        renderItem={({ item, index }) => (
          <SlideCard
            bottomInset={bottomInset}
            index={index}
            isLast={index === slides.length - 1}
            item={item}
            onAdvance={handleAdvance}
            pageWidth={width}
            scrollX={scrollX}
            topInset={insets.top}
            totalSlides={slides.length}
          />
        )}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        style={styles.carousel}
      />
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme'], compact: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    carousel: {
      flex: 1,
    },
    topBar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.xl,
    },
    wordmark: {
      ...theme.type.brand,
      color: theme.colors.textStrong,
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 1.6,
    },
    skipText: {
      ...theme.type.bodyStrong,
      color: theme.colors.accent,
    },
    slide: {
      flex: 1,
      paddingHorizontal: theme.spacing.xl,
      paddingBottom: theme.spacing.lg,
    },
    slideInner: {
      flex: 1,
      justifyContent: 'space-between',
    },
    visualZone: {
      flex: compact ? 0.52 : 0.56,
      minHeight: compact ? 290 : 350,
    },
    visualMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: theme.spacing.md,
      paddingHorizontal: 2,
    },
    sectionPill: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 7,
      backgroundColor: theme.colors.card,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    sectionPillText: {
      ...theme.type.caption,
      color: theme.colors.textStrong,
      textTransform: 'uppercase',
      letterSpacing: 0.9,
      fontWeight: '700',
    },
    sectionIndex: {
      ...theme.type.caption,
      color: theme.colors.textSubtle,
      letterSpacing: 1.1,
      fontWeight: '700',
    },
    sheet: {
      borderRadius: 30,
      paddingTop: theme.spacing.lg,
      paddingHorizontal: theme.spacing.xl,
      backgroundColor: theme.colors.glassStrong,
      borderWidth: 1,
      borderColor: theme.colors.border,
      ...theme.shadows.floating,
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 44,
      height: 5,
      borderRadius: 999,
      backgroundColor: theme.colors.borderStrong,
      marginBottom: theme.spacing.lg,
    },
    sheetEyebrow: {
      ...theme.type.label,
      color: theme.colors.accent,
      marginBottom: theme.spacing.sm,
    },
    sheetTitle: {
      ...theme.type.hero,
      color: theme.colors.textStrong,
      fontSize: compact ? 26 : 30,
      lineHeight: compact ? 32 : 36,
      marginBottom: theme.spacing.md,
    },
    sheetDescription: {
      ...theme.type.body,
      color: theme.colors.textMuted,
      fontSize: compact ? 14 : 15,
      lineHeight: compact ? 21 : 23,
      marginBottom: theme.spacing.lg,
    },
    highlightRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.lg,
    },
    highlightChip: {
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.accentSoft,
    },
    highlightText: {
      ...theme.type.caption,
      color: theme.colors.accentText,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    progressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    },
    progressTrack: {
      flex: 1,
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    progressSegment: {
      flex: 1,
      height: 7,
      borderRadius: 999,
      backgroundColor: theme.colors.cardMuted,
    },
    progressSegmentActive: {
      backgroundColor: theme.colors.accent,
    },
    progressLabel: {
      ...theme.type.bodyStrong,
      color: theme.colors.textSubtle,
      minWidth: 34,
      textAlign: 'right',
    },
    cta: {
      width: '100%',
    },
  });

export default OnboardingScreen;
