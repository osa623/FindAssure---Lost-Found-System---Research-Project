import React, { useState } from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, radius, spacing, type } from '../theme/designSystem';

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
  const [focused, setFocused] = useState(false);
  const disabled = props.editable === false;

  return (
    <View style={containerStyle}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
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
            <Ionicons name={leadingIcon} size={18} color={disabled ? palette.mist : palette.inkSoft} style={styles.icon} />
          </View>
        ) : null}
        <TextInput
          placeholderTextColor={palette.inkSoft}
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
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  label: {
    ...type.label,
    marginBottom: spacing.xs,
  },
  wrapper: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: palette.lineStrong,
    backgroundColor: palette.paperStrong,
    flexDirection: 'row',
    alignItems: 'stretch',
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  wrapperFocused: {
    borderColor: palette.primary,
    shadowColor: palette.primary,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
  },
  wrapperDisabled: {
    backgroundColor: palette.shellAlt,
  },
  wrapperError: {
    borderColor: palette.danger,
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
    marginLeft: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 52,
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: type.body.fontFamily,
    paddingTop: 14,
    paddingBottom: 14,
    paddingRight: spacing.md,
  },
  inputWithoutIcon: {
    paddingLeft: spacing.md,
  },
  multiline: {
    minHeight: 104,
    textAlignVertical: 'top',
    paddingTop: 14,
    paddingBottom: 14,
  },
  inputDisabled: {
    color: palette.inkSoft,
  },
  trailingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  hint: {
    ...type.caption,
    marginTop: spacing.xs,
    color: palette.inkSoft,
  },
  error: {
    ...type.caption,
    marginTop: spacing.xs,
    color: palette.danger,
  },
});
