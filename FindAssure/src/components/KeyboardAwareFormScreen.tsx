import React from 'react';
import {
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';

type KeyboardAwareFormScreenProps = {
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  scrollProps?: Omit<ScrollViewProps, 'children' | 'contentContainerStyle'>;
};

export const KeyboardAwareFormScreen = ({
  children,
  contentContainerStyle,
  style,
  scrollProps,
}: KeyboardAwareFormScreenProps) => {
  const headerHeight = useHeaderHeight();
  const {
    keyboardShouldPersistTaps = 'handled',
    keyboardDismissMode = (Platform.OS === 'ios' ? 'none' : 'on-drag') as ScrollViewProps['keyboardDismissMode'],
    automaticallyAdjustKeyboardInsets = false,
    showsVerticalScrollIndicator = false,
    ...restScrollProps
  } = scrollProps ?? {};

  return (
    <KeyboardAvoidingView
      style={[styles.container, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <ScrollView
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        keyboardDismissMode={keyboardDismissMode}
        automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        contentContainerStyle={[styles.content, contentContainerStyle]}
        {...restScrollProps}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
});
