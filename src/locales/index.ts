export type Locale = 'en';

export const locales: Record<Locale, { name: string; flag: string }> = {
    en: { name: 'English', flag: '🇺🇸' },
};

import enTranslations from './languages/en.json';

export const fallbackTranslations = enTranslations;
