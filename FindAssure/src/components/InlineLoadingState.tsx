import React from 'react';
import { ViewStyle } from 'react-native';
import { FeedbackLoadingShell } from './FeedbackLoadingShell';

interface InlineLoadingStateProps {
  label?: string;
  subtitle?: string;
  style?: ViewStyle;
}

export const InlineLoadingState: React.FC<InlineLoadingStateProps> = ({
  label = 'Loading…',
  subtitle,
  style,
}) => {
  return <FeedbackLoadingShell mode="inline" title={label} message={subtitle} style={style} />;
};
