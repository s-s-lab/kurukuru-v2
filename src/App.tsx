import { Route, Routes } from 'react-router-dom';

import { BrandMark } from './components/BrandMark';
import { HomePage } from './pages/HomePage';
import { NewEventPage } from './pages/NewEventPage';

export function App() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="shell header-inner">
          <a href="#/" className="brand-link">
            <BrandMark />
          </a>
          <span className="header-copy">時間単位日程調整ツール</span>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/events/new" element={<NewEventPage />} />
      </Routes>
      <footer className="site-footer">
        <div className="shell">Kurukuru v2 — 予定を、時間で合わせる。</div>
      </footer>
    </div>
  );
}

