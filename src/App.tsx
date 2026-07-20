import React, { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useStore } from './store';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import TablesPage from './pages/TablesPage';
import MenuPage from './pages/MenuPage';
import CustomOrdersPage from './pages/CustomOrdersPage';
import QuickBillPage from './pages/QuickBillPage';
import DaySummaryPage from './pages/DaySummaryPage';
import MoneyPage from './pages/MoneyPage';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';
import AuditPage from './pages/AuditPage';
import BillsPage from './pages/BillsPage';

export default function App() {
  const { session, init } = useStore();

  useEffect(() => {
    init();
  }, [init]);

  if (!session) return <LoginPage />;

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<TablesPage />} />
        <Route path="/quick" element={<QuickBillPage />} />
        <Route path="/preorders" element={<CustomOrdersPage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/bills" element={<BillsPage />} />
        <Route path="/summary" element={<DaySummaryPage />} />
        <Route path="/money" element={<MoneyPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}
