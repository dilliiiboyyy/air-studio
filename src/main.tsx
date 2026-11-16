import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.DEV) {
  Promise.all([import('./lib/events'), import('./audio/engine'), import('./tracking/tracker'), import('./audio/transport'), import('./lib/db')]).then(([ev, en, tr, tp, d]) => {
    (window as unknown as Record<string, unknown>).__air = { playBus: ev.playBus, engine: en.engine, tracker: tr.tracker, transport: tp.transport, db: d.db };
  });
}
