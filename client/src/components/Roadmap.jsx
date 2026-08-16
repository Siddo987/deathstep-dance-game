import React, { useEffect, useState } from 'react';
import { Map, Clock, Hammer, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../i18n.jsx';
import { fetchPublicRoadmap } from '../admin.js';

// One column per status, in a fixed display order regardless of what order
// the API happens to return groups in (it doesn't group at all - see
// server/index.js's GET /api/roadmap - this component does the grouping).
const COLUMNS = [
  { status: 'planned', icon: Clock, color: 'var(--text-muted)', titleKey: 'roadmap.statusPlanned' },
  { status: 'in_progress', icon: Hammer, color: 'var(--neon-blue)', titleKey: 'roadmap.statusInProgress' },
  { status: 'done', icon: CheckCircle2, color: 'var(--neon-green)', titleKey: 'roadmap.statusDone' },
];

function Roadmap() {
  const { t } = useLanguage();
  const [items, setItems] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchPublicRoadmap().then((r) => { if (!cancelled) setItems(r.error ? [] : r.items); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="app-container" style={{ padding: '20px' }}>
      <div className="cyber-card" style={{ maxWidth: '700px', margin: '0 auto' }}>
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '10px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          <Map size={24} className="icon-inline" />
          {t('roadmap.pageTitle')}
        </h2>
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginBottom: '25px', fontSize: '0.9rem' }}>
          {t('roadmap.subtitle')}
        </p>

        {items === null && <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{t('common.loading')}</p>}

        {items && items.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('roadmap.empty')}</p>
        )}

        {items && items.length > 0 && COLUMNS.map(({ status, icon: Icon, color, titleKey }) => {
          const columnItems = items.filter(i => i.status === status);
          if (columnItems.length === 0) return null;
          return (
            <div key={status} style={{ marginBottom: '25px' }}>
              <h3 style={{ color, fontSize: '1rem', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon size={18} className="icon-inline" />
                {t(titleKey)}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {columnItems.map(item => (
                  <div key={item.id} style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)', borderLeft: `3px solid ${color}` }}>
                    <div style={{ color: 'var(--text-main)', fontWeight: 600 }}>{item.title}</div>
                    {item.description && (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                        {item.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <div style={{ textAlign: 'center', marginTop: '10px' }}>
          <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>{t('common.backToGame')}</a>
        </div>
      </div>
    </div>
  );
}

export default Roadmap;
