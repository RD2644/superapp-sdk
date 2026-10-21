import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import EntryPage from './pages/EntryPage';
import IndexPage from './pages/IndexPage';
import CheckoutPage from './pages/CheckoutPage';
import AgentPage from './pages/AgentPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/entry" replace />} />
        <Route path="/entry" element={<EntryPage />} />
        <Route path="/index" element={<IndexPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/agent" element={<AgentPage />} />
      </Routes>
    </BrowserRouter>
  );
}