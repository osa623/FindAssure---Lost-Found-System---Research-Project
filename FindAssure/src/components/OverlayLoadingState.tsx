import React from 'react';
import { FeedbackLoadingShell } from './FeedbackLoadingShell';

interface OverlayLoadingStateProps {
  visible: boolean;
  badge?: string;
  title?: string;
  message?: string;
  stageLabel?: string;
  note?: string;
  illustrationVariant?: 'auth' | 'pending' | 'success';
}

export const OverlayLoadingState: React.FC<OverlayLoadingStateProps> = ({
  visible,
  badge,
  title = 'Working on it',
  message = 'This usually takes a moment.',
  stageLabel,
  note,
  illustrationVariant = 'pending',
}) => {
  if (!visible) {
    return null;
  }

  return (
    <FeedbackLoadingShell
      mode="overlay"
      badge={badge}
      title={title}
      message={message}
      stageLabel={stageLabel}
      note={note}
      illustrationVariant={illustrationVariant}
    />
  );
};
