import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Offline: o service worker guarda o app no aparelho (só em produção, para não atrapalhar o `npm run dev`).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
