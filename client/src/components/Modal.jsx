import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
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

export function AlertModal({ isOpen, message, onClose, isSuccess = false }) {
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
        <button className={btnClass} onClick={onClose} style={btnStyle}>{t('common.ok')}</button>
      </div>
    </div>,
    document.body
  );
}
