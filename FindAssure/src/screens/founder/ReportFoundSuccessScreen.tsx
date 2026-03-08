import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/models';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAppTheme } from '../../context/ThemeContext';

type ReportFoundSuccessNavigationProp = StackNavigationProp<RootStackParamList, 'ReportFoundSuccess'>;

const ReportFoundSuccessScreen = () => {
  const navigation = useNavigation<ReportFoundSuccessNavigationProp>();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <LinearGradient colors={theme.gradients.appBackground} style={styles.container}>
      <View style={styles.content}>
        <LinearGradient colors={theme.gradients.success} style={styles.hero}>
          <Text style={styles.icon}>✓</Text>
          <Text style={styles.heroTitle}>Thank You !</Text>
          <Text style={styles.heroTitle}>Report submitted.</Text>
          <Text style={styles.heroBody}>The item is now ready for owner search and verification.</Text>
        </LinearGradient>

        <PrimaryButton title="Back to Home" onPress={() => navigation.navigate('Home')} size="lg" />
      </View>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    container: { flex: 1 },
    content: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.xl,
      paddingBottom: theme.spacing.xl,
    },
    hero: {
      borderRadius: theme.radius.xl,
      padding: theme.spacing.xl,
      alignItems: 'center',
      marginBottom: theme.spacing.xl,
    },
    icon: {
      ...theme.type.hero,
      color: theme.colors.onTint,
      marginBottom: theme.spacing.sm,
    },
    heroTitle: {
      ...theme.type.hero,
      color: theme.colors.onTint,
      textAlign: 'center',
      marginBottom: theme.spacing.sm,
    },
    heroBody: {
      ...theme.type.body,
      color: theme.colors.onTintMuted,
      textAlign: 'center',
    },
  });

export default ReportFoundSuccessScreen;
