import React from 'react';
import { FeedbackLoadingShell } from './FeedbackLoadingShell';

interface LoadingScreenProps {
  message?: string;
  subtitle?: string;
  badge?: string;
  stageLabel?: string;
  note?: string;
  illustrationVariant?: 'auth' | 'pending' | 'success';
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  message = 'Loading…',
  subtitle,
  badge = 'FindAssure',
  stageLabel,
  note,
  illustrationVariant = 'pending',
}) => {
  return (
    <FeedbackLoadingShell
      mode="screen"
      badge={badge}
      title={message}
      message={subtitle}
      stageLabel={stageLabel}
      note={note}
      illustrationVariant={illustrationVariant}
    />
  );
};
