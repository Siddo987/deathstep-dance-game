import React from 'react';
import { createPortal } from 'react-dom';

export function ConfirmModal({ isOpen, message, onConfirm, onCancel }) {
  if (!isOpen) return null;
  return createPortal(
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div className="cyber-card pulse-animation" style={{ maxWidth: '400px', width: '90%', margin: '0 20px', border: '1px solid var(--neon-purple)', textAlign: 'center', animation: 'none' }}>
        <h3 style={{ color: 'var(--text-main)', marginBottom: '30px', fontSize: '1.2rem', lineHeight: '1.5' }}>{message}</h3>
        <div style={{ display: 'flex', gap: '15px' }}>
          <button className="cyber-button" onClick={() => { onConfirm(); onCancel(); }} style={{ flex: 1, padding: '10px' }}>YES</button>
          <button className="cyber-button" onClick={onCancel} style={{ flex: 1, background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)', padding: '10px' }}>NO</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function AlertModal({ isOpen, message, onClose }) {
  if (!isOpen) return null;
  const isSuccess = message && (message.includes('successfully') || message.includes('Successfully'));
  const borderColor = isSuccess ? '#1db954' : 'var(--neon-red)';
  const boxShadowColor = isSuccess ? 'rgba(29, 185, 84, 0.3)' : 'rgba(255,42,85,0.3)';
  const btnClass = isSuccess ? 'cyber-button' : 'cyber-button danger';
  const btnStyle = isSuccess ? { width: '100%', padding: '10px', background: '#1db954', color: 'black' } : { width: '100%', padding: '10px' };

  return createPortal(
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div className="cyber-card" style={{ maxWidth: '400px', width: '90%', margin: '0 20px', border: `1px solid ${borderColor}`, textAlign: 'center', boxShadow: `0 0 20px ${boxShadowColor}` }}>
        <h3 style={{ color: 'var(--text-main)', marginBottom: '30px', fontSize: '1.2rem', lineHeight: '1.5' }}>{message}</h3>
        <button className={btnClass} onClick={onClose} style={btnStyle}>OK</button>
      </div>
    </div>,
    document.body
  );
}
