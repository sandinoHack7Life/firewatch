import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/layout/AppLayout';
import { AnalyticsPage } from './features/analytics/AnalyticsPage';
import { AlertsPage } from './features/alerts/AlertsPage';
import { CalendarPage } from './features/calendar/CalendarPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DataExplorerPage } from './features/data-explorer/DataExplorerPage';
import { FireMapPage } from './features/fire-map/FireMapPage';
import { FieldVisitsPage } from './features/field-visits/FieldVisitsPage';
import { HarmonizationPage } from './features/harmonization/HarmonizationPage';
import { MethodologyPage } from './features/methodology/MethodologyPage';
import { ReportsPage } from './features/reports/ReportsPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="/" element={<DashboardPage />} />
        <Route path="/fire-map" element={<FireMapPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/harmonization" element={<HarmonizationPage />} />
        <Route path="/data-explorer" element={<DataExplorerPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/field-visits" element={<FieldVisitsPage />} />
        <Route path="/methodology" element={<MethodologyPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
