import { ITEM_CATEGORIES } from '../constants/appConstants';

const normalizeCategoryKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const CATEGORY_ALIASES: Record<string, string> = {
  smartphone: 'Smartphone',
  'smart phone': 'Smartphone',
  phone: 'Smartphone',
  mobile: 'Smartphone',
  'mobile phone': 'Smartphone',
  cellphone: 'Smartphone',
  'cell phone': 'Smartphone',
  backpack: 'Backpack',
  bag: 'Backpack',
  handbag: 'Handbag',
  purse: 'Handbag',
  wallet: 'Wallet',
  helmet: 'Helmet',
  key: 'Key',
  keys: 'Key',
  charger: 'Charger',
  'laptop charger': 'Charger',
  notebook: 'Notebook',
  laptop: 'Laptop',
  'student id': 'Student ID',
  'student id card': 'Student ID',
  'id card': 'Student ID',
  id: 'Student ID',
  'earbud earbud case': 'Earbud/Earbud Case',
  'earbuds earbud case': 'Earbud/Earbud Case',
  'earbuds earbuds case': 'Earbud/Earbud Case',
  'earbuds case': 'Earbud/Earbud Case',
  earbuds: 'Earbud/Earbud Case',
  earbud: 'Earbud/Earbud Case',
  'earbud case': 'Earbud/Earbud Case',
};

const CATEGORY_LOOKUP = ITEM_CATEGORIES.reduce<Record<string, string>>((lookup, category) => {
  lookup[normalizeCategoryKey(category)] = category;
  return lookup;
}, {});

export const resolveItemCategory = (rawCategory?: string | null): string | undefined => {
  if (!rawCategory) {
    return undefined;
  }

  const normalized = normalizeCategoryKey(rawCategory);
  if (!normalized) {
    return undefined;
  }

  return CATEGORY_LOOKUP[normalized] || CATEGORY_ALIASES[normalized];
};
