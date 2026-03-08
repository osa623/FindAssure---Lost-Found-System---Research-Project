import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, type } from '../theme/designSystem';

interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ eyebrow, title, subtitle }) => {
  return (
    <View style={styles.container}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.xl,
  },
  eyebrow: {
    ...type.label,
    marginBottom: spacing.xs,
  },
  title: {
    ...type.title,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...type.body,
  },
});
