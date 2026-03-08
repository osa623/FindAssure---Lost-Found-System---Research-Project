import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { useAppTheme } from '../context/ThemeContext';

interface FormInputProps extends TextInputProps {
  label?: string;
  hint?: string | null;
  error?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
  inputContainerStyle?: StyleProp<ViewStyle>;
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  trailing?: React.ReactNode;
}

export const FormInput: React.FC<FormInputProps> = ({
  label,
  hint,
  error,
  containerStyle,
  inputContainerStyle,
  leadingIcon,
  trailing,
  multiline,
  style,
  ...props
}) => {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const disabled = props.editable === false;

  return (
    <View style={containerStyle}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable
        onPress={() => {
          if (!disabled) inputRef.current?.focus();
        }}
        style={[
          styles.wrapper,
          focused && styles.wrapperFocused,
          disabled && styles.wrapperDisabled,
          error ? styles.wrapperError : null,
          inputContainerStyle,
        ]}
      >
        {leadingIcon ? (
          <View style={[styles.iconWrap, multiline && styles.iconWrapMultiline]}>
            <Ionicons
              name={leadingIcon}
              size={18}
              color={disabled ? theme.colors.textSubtle : theme.colors.textMuted}
              style={styles.icon}
            />
          </View>
        ) : null}
        <TextInput
          ref={inputRef}
          placeholderTextColor={theme.colors.placeholder}
          multiline={multiline}
          style={[
            styles.input,
            !leadingIcon && styles.inputWithoutIcon,
            multiline && styles.multiline,
            disabled && styles.inputDisabled,
            style,
          ]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />
        {trailing ? <View style={styles.trailingWrap}>{trailing}</View> : null}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) =>
  StyleSheet.create({
    label: {
      ...theme.type.label,
      marginBottom: theme.spacing.xs,
    },
    wrapper: {
      borderRadius: theme.radius.md,
      borderWidth: 1.5,
      borderColor: theme.colors.borderStrong,
      backgroundColor: theme.colors.input,
      flexDirection: 'row',
      alignItems: 'stretch',
      minHeight: 54,
    },
    wrapperFocused: {
      borderColor: theme.colors.accent,
      shadowColor: theme.colors.accent,
      shadowOpacity: theme.isDark ? 0.2 : 0.08,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 0 },
      elevation: 2,
    },
    wrapperDisabled: {
      backgroundColor: theme.colors.inputMuted,
    },
    wrapperError: {
      borderColor: theme.colors.danger,
    },
    iconWrap: {
      width: 42,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconWrapMultiline: {
      justifyContent: 'flex-start',
      paddingTop: 14,
    },
    icon: {
      marginLeft: theme.spacing.sm,
    },
    input: {
      flex: 1,
      minHeight: 52,
      color: theme.colors.textStrong,
      fontSize: 15,
      lineHeight: 20,
      fontFamily: theme.type.body.fontFamily,
      paddingTop: 14,
      paddingBottom: 14,
      paddingRight: theme.spacing.md,
    },
    inputWithoutIcon: {
      paddingLeft: theme.spacing.md,
    },
    multiline: {
      minHeight: 108,
      textAlignVertical: 'top',
      lineHeight: 21,
      paddingTop: 14,
      paddingBottom: 14,
    },
    inputDisabled: {
      color: theme.colors.textMuted,
    },
    trailingWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingRight: theme.spacing.md,
    },
    hint: {
      ...theme.type.caption,
      marginTop: theme.spacing.xs,
      color: theme.colors.textMuted,
    },
    error: {
      ...theme.type.caption,
      marginTop: theme.spacing.xs,
      color: theme.colors.danger,
    },
  });
