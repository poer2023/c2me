import { en, TranslationKey } from './locales/en';
import { zh } from './locales/zh';

export type Language = 'en' | 'zh';

const translations: Record<Language, Record<TranslationKey, string>> = {
  en,
  zh,
};

export function translate(language: Language, key: TranslationKey): string {
  return translations[language][key] || key;
}

export function createTranslator(language: Language): (key: TranslationKey) => string {
  return (key: TranslationKey) => translate(language, key);
}

export type { TranslationKey };
