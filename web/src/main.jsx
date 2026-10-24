import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { I18nProvider } from './i18n/index.jsx';
import { applyTheme, initialTheme, ThemeProvider } from './theme.jsx';
import './styles/tokens.css';
import './styles/app.css';

// Before the first paint, so a light-theme visitor never sees a dark flash.
applyTheme(initialTheme());

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
