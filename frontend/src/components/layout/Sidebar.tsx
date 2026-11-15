import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const navItems = [
  { path: '/', label: 'Overview' },
  { path: '/fire-map', label: 'Fire Map' },
  { path: '/calendar', label: 'Burning Activity Calendar' },
  { path: '/analytics', label: 'Historical Analytics' },
  { path: '/harmonization', label: 'Harmonization Explorer' },
  { path: '/data-explorer', label: 'Data Explorer' },
  { path: '/reports', label: 'Reports & Export' },
  { path: '/alerts', label: 'Alerts & Watchlists' },
  { path: '/field-visits', label: 'Field Verification Visits' },
  { path: '/methodology', label: 'Methodology & About' },
];

export function Sidebar() {
  const { t } = useTranslation();

  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">F</div>
        <div>
          <p className="eyebrow">NASA Space Apps</p>
          <h1>Firewatch</h1>
        </div>
      </div>

      <nav className="nav" aria-label={t('Sidebar navigation')}>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            {t(item.label)}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-note">
        <strong>{t('Scientific caution:')}</strong> {t('Satellite thermal anomalies are not confirmed fires. Park boundaries are mapped estimates, not legal dispatch boundaries.')}
      </div>
    </aside>
  );
}
