import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../context/ThemeContext';

interface FeatureCardProps {
  icon: string;
  title: string;
  description: string;
  onPress: () => void;
  gradient?: readonly [string, string, ...string[]];
}

export const FeatureCard: React.FC<FeatureCardProps> = ({
  icon,
  title,
  description,
  onPress,
  gradient,
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const colors = gradient ?? theme.gradients.violet;

  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.8}>
      <LinearGradient colors={colors} style={styles.gradient}>
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
        <View style={styles.content}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>
        </View>
        <Text style={styles.arrow}>›</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: {
      borderRadius: theme.radius.md,
      overflow: 'hidden',
      marginBottom: theme.spacing.md,
      ...theme.shadows.soft,
    },
    gradient: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: theme.spacing.lg,
    },
    iconContainer: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.colors.tintSurface,
      borderWidth: 1,
      borderColor: theme.colors.tintBorder,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: theme.spacing.md,
    },
    icon: {
      fontSize: 24,
    },
    content: {
      flex: 1,
    },
    title: {
      ...theme.type.cardTitle,
      color: theme.colors.onTint,
      marginBottom: 4,
    },
    description: {
      ...theme.type.caption,
      color: theme.colors.onTintMuted,
    },
    arrow: {
      fontSize: 28,
      color: theme.colors.onTint,
      opacity: 0.7,
      fontWeight: '300',
    },
  });
