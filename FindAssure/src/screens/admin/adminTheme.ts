import { useAppTheme } from '../../context/ThemeContext';
import { FoundItem, User } from '../../types/models';

type AppTheme = ReturnType<typeof useAppTheme>['theme'];

export const getAdminPalette = (theme: AppTheme) => ({
  accent: theme.colors.danger,
  accentSoft: theme.colors.dangerSoft,
  accentText: theme.colors.danger,
  contrastText: theme.colors.inverse,
  neutralSurface: theme.colors.cardMuted,
  highlight: theme.colors.accent,
  highlightSoft: theme.colors.accentSoft,
});

export const getAdminItemStatusTone = (
  theme: AppTheme,
  status: FoundItem['status'] | string
) => {
  switch (status) {
    case 'available':
      return { backgroundColor: theme.colors.success, textColor: theme.colors.inverse };
    case 'pending_verification':
      return { backgroundColor: theme.colors.warning, textColor: theme.colors.inverse };
    case 'claimed':
      return { backgroundColor: theme.colors.textSubtle, textColor: theme.colors.inverse };
    default:
      return { backgroundColor: theme.colors.textMuted, textColor: theme.colors.inverse };
  }
};

export const getAdminRoleTone = (theme: AppTheme, role: User['role']) => {
  if (role === 'admin') {
    return {
      backgroundColor: theme.colors.dangerSoft,
      textColor: theme.colors.danger,
    };
  }

  return {
    backgroundColor: theme.colors.accentSoft,
    textColor: theme.colors.accent,
  };
};

export const getAdminUserCardTone = (
  theme: AppTheme,
  options: {
    isAdmin: boolean;
    isSuspended: boolean;
    isSuspicious: boolean;
  }
) => {
  if (options.isAdmin) {
    return {
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
    };
  }

  if (options.isSuspended) {
    return {
      borderColor: theme.colors.textSubtle,
      backgroundColor: theme.colors.cardMuted,
    };
  }

  if (options.isSuspicious) {
    return {
      borderColor: theme.colors.danger,
      backgroundColor: theme.colors.dangerSoft,
    };
  }

  return {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  };
};

export const getAdminRiskTone = (
  theme: AppTheme,
  type: 'critical' | 'suspended' | 'protected'
) => {
  switch (type) {
    case 'critical':
      return {
        backgroundColor: theme.colors.danger,
        textColor: theme.colors.inverse,
      };
    case 'suspended':
      return {
        backgroundColor: theme.colors.cardMuted,
        textColor: theme.colors.textStrong,
      };
    default:
      return {
        backgroundColor: theme.colors.warningSoft,
        textColor: theme.colors.warning,
      };
  }
};
