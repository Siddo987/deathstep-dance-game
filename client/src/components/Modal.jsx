import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, CheckCircle2, AlertTriangle, Skull, X, Music2, Puzzle, HeartCrack, Eye, Shield, Hand } from 'lucide-react';
import { useLanguage } from '../i18n.jsx';

function useEscapeKey(isOpen, onEscape) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onEscape(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onEscape]);
}

export function ConfirmModal({ isOpen, message, onConfirm, onCancel }) {
  const { t } = useLanguage();
  useEscapeKey(isOpen, onCancel || (() => {}));
  if (!isOpen) return null;
  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-card cyber-card"
        style={{ maxWidth: '400px', textAlign: 'center', border: '1px solid var(--neon-purple)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <HelpCircle size={36} style={{ color: 'var(--neon-purple)', marginBottom: '15px' }} />
        <h3 style={{ color: 'var(--text-main)', marginBottom: '30px', fontSize: '1.2rem', lineHeight: '1.5' }}>{message}</h3>
        <div className="btn-row">
          <button className="cyber-button" onClick={() => { onConfirm(); onCancel(); }} style={{ flex: 1, padding: '10px' }}>{t('common.yes')}</button>
          <button className="cyber-button" onClick={onCancel} style={{ flex: 1, background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)', padding: '10px' }}>{t('common.no')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// actionLabel/onAction optionally add a second button (e.g. "Reconnect now")
// next to the default OK button, for alerts the user can fix in one click
// instead of just acknowledging.
export function AlertModal({ isOpen, message, onClose, isSuccess = false, actionLabel, onAction }) {
  const { t } = useLanguage();
  useEscapeKey(isOpen, onClose || (() => {}));
  if (!isOpen) return null;
  const accentColor = isSuccess ? 'var(--neon-green)' : 'var(--neon-red)';
  const boxShadowColor = isSuccess ? 'rgba(29, 185, 84, 0.3)' : 'rgba(255,42,85,0.3)';
  const btnClass = isSuccess ? 'cyber-button' : 'cyber-button danger';
  const btnStyle = isSuccess ? { width: '100%', padding: '10px', background: 'var(--neon-green)', color: 'black' } : { width: '100%', padding: '10px' };
  const Icon = isSuccess ? CheckCircle2 : AlertTriangle;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card cyber-card"
        style={{ maxWidth: '400px', textAlign: 'center', border: `1px solid ${accentColor}`, boxShadow: `0 0 20px ${boxShadowColor}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <Icon size={36} style={{ color: accentColor, marginBottom: '15px' }} />
        <h3 style={{ color: 'var(--text-main)', marginBottom: '30px', fontSize: '1.2rem', lineHeight: '1.5' }}>{message}</h3>
        {actionLabel && onAction ? (
          <div className="btn-row">
            <button className="cyber-button" style={{ flex: 1, padding: '10px' }} onClick={() => { onAction(); onClose(); }}>{actionLabel}</button>
            <button className={btnClass} onClick={onClose} style={{ flex: 1, padding: '10px', ...(isSuccess ? { background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' } : {}) }}>{t('common.ok')}</button>
          </div>
        ) : (
          <button className={btnClass} onClick={onClose} style={btnStyle}>{t('common.ok')}</button>
        )}
      </div>
    </div>,
    document.body
  );
}

// Plain-language rules explainer for a first-time GM or player - reachable
// from Home.jsx (both the main screen and the join view, since a player
// scanning a QR code lands directly on the join view and never sees the main
// screen at all) and from the lobby-wait screens of GMDashboard.jsx/
// PlayerScreen.jsx, the other moment someone is idle with nothing else to do
// but wonder what's about to happen. Content-only (no game-state dependency)
// so the same component works from any of those call sites unmodified.
export function HowToPlayModal({ isOpen, onClose }) {
  const { t } = useLanguage();
  useEscapeKey(isOpen, onClose || (() => {}));
  if (!isOpen) return null;

  const steps = [1, 2, 3, 4, 5];
  // Role legend - deliberately lists every special role regardless of
  // whether *this* room has any enabled (this modal is content-only, no
  // game-state dependency, reachable before a room even exists - see the
  // comment on the component above). Reuses the exact same title/instruction
  // locale keys as the in-round Role Reveal panels (PlayerScreen.jsx) rather
  // than duplicating the copy, so the two surfaces can never drift apart.
  const roles = [
    { icon: Skull, color: 'var(--neon-red)', titleKey: 'player.youAreKillers', bodyKey: 'player.killerInstructions' },
    { icon: Music2, color: 'var(--neon-blue)', titleKey: 'player.youAreDancers', bodyKey: 'player.dancerInstructions' },
    { icon: Puzzle, color: 'var(--neon-purple)', titleKey: 'player.youArePuzzleRole', bodyKey: 'player.puzzleRoleInstructions' },
    { icon: HeartCrack, color: 'var(--neon-purple)', titleKey: 'player.youAreMartyr', bodyKey: 'player.martyrInstructions' },
    { icon: Eye, color: 'var(--neon-purple)', titleKey: 'player.youAreSeer', bodyKey: 'player.seerInstructions' },
    { icon: Shield, color: 'var(--neon-purple)', titleKey: 'player.youAreProtector', bodyKey: 'player.protectorInstructions' },
    { icon: Hand, color: 'var(--neon-purple)', titleKey: 'player.youAreToucher', bodyKey: 'player.toucherInstructions' },
  ];
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card cyber-card"
        style={{ maxWidth: '480px', border: '1px solid var(--neon-blue)', textAlign: 'left', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h3 style={{ color: 'var(--neon-blue)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Skull size={20} className="icon-inline" /> {t('howto.title')}
          </h3>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <p style={{ color: 'var(--text-muted)', marginBottom: '18px' }}>{t('howto.intro')}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '15px' }}>
          {steps.map(n => (
            <div key={n} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{
                flexShrink: 0, width: '26px', height: '26px', borderRadius: '50%',
                border: '1px solid var(--neon-purple)', color: 'var(--neon-purple)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.85rem',
              }}>
                {n}
              </div>
              <div>
                <strong style={{ color: 'white', display: 'block', marginBottom: '2px' }}>{t(`howto.step${n}Title`)}</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t(`howto.step${n}Body`)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="panel panel--info" style={{ marginBottom: '15px' }}>
          <p style={{ margin: 0, color: 'white', fontSize: '0.9rem' }}>{t('howto.winCondition')}</p>
        </div>

        <h4 style={{ color: 'var(--neon-purple)', margin: '0 0 4px 0' }}>{t('howto.rolesTitle')}</h4>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '12px' }}>{t('howto.rolesIntro')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {roles.map(({ icon: Icon, color, titleKey, bodyKey }) => (
            <div key={titleKey} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <Icon size={18} style={{ color, flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ color: 'white', display: 'block', marginBottom: '2px', fontSize: '0.9rem' }}>{t(titleKey)}</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t(bodyKey)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
