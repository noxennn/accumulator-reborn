import React from 'react';
import { Moon, Sun, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const ThemeToggle = () => {
  const [theme, setTheme] = React.useState<'light' | 'dark'>('light');
  const { i18n } = useTranslation();

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'tr' : 'en';
    i18n.changeLanguage(newLang);
  };

  return (
    <div className="flex gap-2">
      <button
        className="btn btn-ghost btn-circle"
        onClick={toggleLanguage}
        title={i18n.language === 'en' ? 'Türkçe' : 'English'}
      >
        <Globe className="w-5 h-5" />
      </button>
      <button
        className="btn btn-ghost btn-circle"
        onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      >
        {theme === 'light' ? (
          <Moon className="w-5 h-5" />
        ) : (
          <Sun className="w-5 h-5" />
        )}
      </button>
    </div>
  );
};

export default ThemeToggle;