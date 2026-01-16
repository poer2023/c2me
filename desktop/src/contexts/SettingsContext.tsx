import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Language, TranslationKey, translate } from '../i18n';

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  theme: Theme;
  language: Language;
}

interface SettingsContextValue {
  settings: Settings;
  updateTheme: (theme: Theme) => void;
  updateLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
  effectiveTheme: 'light' | 'dark';
}

const STORAGE_KEY = 'chatcode-settings';

const defaultSettings: Settings = {
  theme: 'system',
  language: 'en',
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return defaultSettings;
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemTheme);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Calculate effective theme
  const effectiveTheme = settings.theme === 'system' ? systemTheme : settings.theme;

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark');
    root.classList.add(`theme-${effectiveTheme}`);
    root.setAttribute('data-theme', effectiveTheme);
  }, [effectiveTheme]);

  // Save settings when changed
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const updateTheme = useCallback((theme: Theme) => {
    setSettings(prev => ({ ...prev, theme }));
  }, []);

  const updateLanguage = useCallback((language: Language) => {
    setSettings(prev => ({ ...prev, language }));
  }, []);

  const t = useCallback((key: TranslationKey) => {
    return translate(settings.language, key);
  }, [settings.language]);

  return (
    <SettingsContext.Provider value={{ settings, updateTheme, updateLanguage, t, effectiveTheme }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
