import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import i18n from './i18n';

const syncDocumentTitle = () => {
  document.title = i18n.t('documentTitle');
};
i18n.on('initialized', syncDocumentTitle);
i18n.on('languageChanged', syncDocumentTitle);
if (i18n.isInitialized) {
  syncDocumentTitle();
}

const container = document.getElementById('root');
if (!container) throw new Error('Failed to find the root element');
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);