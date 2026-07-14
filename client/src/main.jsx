import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import '@fontsource/orbitron/400.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
// Latin + Latin Extended only (covers German umlauts and other European names) -
// the default weight CSS files pull in cyrillic/greek/vietnamese subsets too,
// which this German-language app never needs.
import '@fontsource/inter/latin-300.css';
import '@fontsource/inter/latin-ext-300.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-ext-600.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
