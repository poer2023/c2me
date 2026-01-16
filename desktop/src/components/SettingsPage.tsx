import { useSettings, Theme } from '../contexts/SettingsContext';
import { Language } from '../i18n';

interface SettingsPageProps {
  onClose?: () => void;
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const { settings, updateTheme, updateLanguage, t } = useSettings();

  const themes: { value: Theme; labelKey: 'settings.themeSystem' | 'settings.themeLight' | 'settings.themeDark'; icon: string }[] = [
    { value: 'system', labelKey: 'settings.themeSystem', icon: '💻' },
    { value: 'light', labelKey: 'settings.themeLight', icon: '☀️' },
    { value: 'dark', labelKey: 'settings.themeDark', icon: '🌙' },
  ];

  const languages: { value: Language; labelKey: 'settings.languageEn' | 'settings.languageZh'; flag: string }[] = [
    { value: 'en', labelKey: 'settings.languageEn', flag: '🇺🇸' },
    { value: 'zh', labelKey: 'settings.languageZh', flag: '🇨🇳' },
  ];

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2>{t('settings.title')}</h2>
        {onClose && (
          <button className="settings-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>

      <div className="settings-content">
        {/* Theme Selection */}
        <div className="settings-section">
          <label className="settings-label">{t('settings.theme')}</label>
          <div className="settings-options">
            {themes.map(({ value, labelKey, icon }) => (
              <button
                key={value}
                className={`settings-option ${settings.theme === value ? 'active' : ''}`}
                onClick={() => updateTheme(value)}
              >
                <span className="option-icon">{icon}</span>
                <span className="option-label">{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Language Selection */}
        <div className="settings-section">
          <label className="settings-label">{t('settings.language')}</label>
          <div className="settings-options">
            {languages.map(({ value, labelKey, flag }) => (
              <button
                key={value}
                className={`settings-option ${settings.language === value ? 'active' : ''}`}
                onClick={() => updateLanguage(value)}
              >
                <span className="option-icon">{flag}</span>
                <span className="option-label">{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
