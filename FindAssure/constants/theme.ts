import { Platform } from 'react-native';
import { palette, fonts } from '../src/theme/designSystem';

const tintColorLight = palette.primary;
const tintColorDark = palette.paperStrong;

export const Colors = {
  light: {
    text: palette.ink,
    background: palette.paper,
    tint: tintColorLight,
    icon: palette.mist,
    tabIconDefault: palette.mist,
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: palette.paperStrong,
    background: '#101826',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: fonts.body,
    serif: fonts.display,
    rounded: fonts.display,
    mono: 'ui-monospace',
  },
  default: {
    sans: fonts.body,
    serif: fonts.display,
    rounded: fonts.display,
    mono: 'monospace',
  },
  web: {
    sans: "Avenir Next, ui-sans-serif, system-ui, sans-serif",
    serif: "Avenir Next, ui-serif, serif",
    rounded: "Avenir Next, ui-sans-serif, sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
