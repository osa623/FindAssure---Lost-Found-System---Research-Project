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
import { GlassCard } from './GlassCard';
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

  return (
    <View style={containerStyle}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <GlassCard
        intensity={0}
        style={[
          styles.wrapper,
          focused && styles.wrapperFocused,
          error ? styles.wrapperError : null,
        ]}
        contentStyle={[styles.field, inputContainerStyle]}
      >
        {leadingIcon ? (
          <Ionicons name={leadingIcon} size={18} color={palette.mist} style={styles.icon} />
        ) : null}
        <TextInput
          placeholderTextColor={palette.inkSoft}
          multiline={multiline}
          style={[styles.input, multiline && styles.multiline, style]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />
        {trailing}
      </GlassCard>
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
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  wrapperFocused: {
    borderColor: palette.primary,
    shadowColor: palette.primary,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 1,
  },
  wrapperError: {
    borderColor: palette.danger,
  },
  field: {
    paddingVertical: 0,
    paddingHorizontal: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 52,
    backgroundColor: palette.paperStrong,
  },
  icon: {
    marginLeft: spacing.md,
    marginRight: spacing.sm,
    alignSelf: 'center',
  },
  input: {
    flex: 1,
    minHeight: 52,
    color: palette.ink,
    fontSize: 15,
    fontFamily: type.body.fontFamily,
    paddingVertical: 13,
    paddingRight: spacing.md,
  },
  multiline: {
    minHeight: 92,
    textAlignVertical: 'top',
    paddingTop: 13,
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
