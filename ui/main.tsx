import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/literata/400.css';
import '@fontsource/literata/500.css';
import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/600.css';
import './style.css';
import { App } from './App.js';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
