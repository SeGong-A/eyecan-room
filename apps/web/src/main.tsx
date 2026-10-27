import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { TVDisplay } from './components/TVDisplay';
import './style.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  window.location.pathname === '/tv-display' ? <TVDisplay /> : <App />
);
