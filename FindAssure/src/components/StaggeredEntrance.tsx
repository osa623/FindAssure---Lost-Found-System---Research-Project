import React, { useMemo } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useAppTheme } from '../context/ThemeContext';

interface StaggeredEntranceProps {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

export const StaggeredEntrance: React.FC<StaggeredEntranceProps> = ({
  children,
  delay = 0,
  style,
}) => {
  const { theme } = useAppTheme();
  const entering = useMemo(
    () => FadeInDown.delay(delay).duration(theme.motion.duration.normal + 80),
    [delay, theme.motion.duration.normal]
  );

  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
};
