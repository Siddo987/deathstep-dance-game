import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, CheckCircle2, AlertTriangle, Skull, X, Music2, Puzzle, HeartCrack, Eye, Shield, Hand, Globe } from 'lucide-react';
import { useLanguage, SUPPORTED_LANGS } from '../i18n.jsx';
import { phaseBodyKeyFor } from '../phaseExplanations.js';

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

// In-room language switcher - reachable from GMDashboard's and PlayerScreen's
// kebab ("three-dot") menus, so switching language no longer requires leaving
// the room back to Home.jsx (the only place this used to be possible; see
// Home.jsx's own LanguageSwitcher, which stays as the pre-room picker). Both
// draw from the same SUPPORTED_LANGS list and the same setLang() from
// useLanguage(), so a language picked here takes effect immediately for
// every t() call in the room, GM and player alike - there's nothing
// room/server-side to sync, this is purely local display language.
export function LanguageModal({ isOpen, onClose }) {
  const { t, lang, setLang } = useLanguage();
  useEscapeKey(isOpen, onClose || (() => {}));
  if (!isOpen) return null;

  const langButton = (code) => (
    <button
      key={code}
      onClick={() => { setLang(code); onClose(); }}
      style={{
        background: lang === code ? 'rgba(0,240,255,0.12)' : 'transparent',
        border: lang === code ? '1px solid var(--neon-blue)' : '1px solid rgba(136,146,176,0.4)',
        color: lang === code ? 'var(--neon-blue)' : 'var(--text-muted)',
        padding: '10px 12px',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '0.9rem',
        letterSpacing: '1px',
        fontWeight: lang === code ? 'bold' : 'normal',
      }}
    >
      {code.toUpperCase()}
    </button>
  );

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card cyber-card"
        style={{ maxWidth: '360px', border: '1px solid var(--neon-blue)', textAlign: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ color: 'var(--neon-blue)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Globe size={20} className="icon-inline" /> {t('common.languageMenuItem')}
          </h3>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {SUPPORTED_LANGS.map(langButton)}
        </div>
      </div>
    </div>,
    document.body
  );
}

// Plain-language rules explainer for a first-time GM or player - reachable
// from Home.jsx (both the main screen and the join view, since a player
// scanning a QR code lands directly on the join view and never sees the main
// screen at all) and from the lobby-wait screens of GMDashboard.jsx/
// PlayerScreen.jsx, plus the persistent (?) icon both show throughout an
// entire game now (see topIconRow in PlayerScreen.jsx). That last spot is
// why this got dynamic: read from Home.jsx, or from a lobby with settings
// still in flux, there's no "current" mode/role to narrow to, so it stays
// the full generic overview+legend it always was. Read mid-round, showing
// all 7 roles and a 5-step "how the app works" walkthrough nobody asked for
// anymore is just noise - so once `inRound` is true this narrows to the
// mode actually being played and (for a player) the one role they actually
// have, via the optional gameMode/inRound/myRole/mySpecialRole/
// activeSpecialRoles/roomStatus props. None of the three call sites are
// required to pass them - omitting all of them reproduces the original
// always-show-everything behavior exactly.
export function HowToPlayModal({ isOpen, onClose, gameMode, inRound, myRole, mySpecialRole, activeSpecialRoles, roomStatus }) {
  const { t } = useLanguage();
  useEscapeKey(isOpen, onClose || (() => {}));
  if (!isOpen) return null;

  const steps = [1, 2, 3, 4, 5];
  // Role legend - keyed by `key` (not just titleKey) so the narrowing logic
  // below can filter by plain role/specialRole identifiers instead of
  // string-matching locale keys. Reuses the exact same title/instruction
  // locale keys as the in-round Role Reveal panels (PlayerScreen.jsx) rather
  // than duplicating the copy, so the two surfaces can never drift apart.
  const allRoles = [
    { key: 'killer', icon: Skull, color: 'var(--neon-red)', titleKey: 'player.youAreKillers', bodyKey: 'player.killerInstructions' },
    { key: 'dancer', icon: Music2, color: 'var(--neon-blue)', titleKey: 'player.youAreDancers', bodyKey: 'player.dancerInstructions' },
    { key: 'puzzle', icon: Puzzle, color: 'var(--neon-purple)', titleKey: 'player.youArePuzzleRole', bodyKey: 'player.puzzleRoleInstructions' },
    { key: 'martyr', icon: HeartCrack, color: 'var(--neon-purple)', titleKey: 'player.youAreMartyr', bodyKey: 'player.martyrInstructions' },
    { key: 'seer', icon: Eye, color: 'var(--neon-purple)', titleKey: 'player.youAreSeer', bodyKey: 'player.seerInstructions' },
    { key: 'protector', icon: Shield, color: 'var(--neon-purple)', titleKey: 'player.youAreProtector', bodyKey: 'player.protectorInstructions' },
    { key: 'toucher', icon: Hand, color: 'var(--neon-purple)', titleKey: 'player.youAreToucher', bodyKey: 'player.toucherInstructions' },
  ];

  // A player prop (even just myRole==='dancer' with no special role) means
  // this is PlayerScreen's call site; a mode with no player props but
  // inRound means GMDashboard's. Home.jsx's and a still-open lobby's calls
  // pass none of this, so `narrowed` stays false and every branch below is
  // skipped - identical to the old unconditional behavior.
  const isPlayerContext = !!myRole;
  const narrowed = !!inRound;
  const roles = !narrowed
    ? allRoles
    : isPlayerContext
      ? allRoles.filter(r => r.key === myRole || r.key === mySpecialRole)
      : allRoles.filter(r => r.key === 'killer' || r.key === 'dancer' || (activeSpecialRoles || []).includes(r.key));

  const modeDescKey = gameMode === 'chaos' ? 'gm.gameModeChaosDesc' : gameMode === 'maxkills' ? 'gm.gameModeMaxKillsDesc' : 'gm.gameModeStandardDesc';
  // Same gm.readAloudPhase* keys as GMDashboard's dedicated read-aloud
  // popup (see phaseExplanations.js) - one source of "what's happening in
  // this phase" per surface, reused here as a quick reference instead of
  // GM-toolbar-only.
  const phaseKey = narrowed ? phaseBodyKeyFor(roomStatus, gameMode) : null;

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

        {!narrowed && (
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
        )}

        <div className="panel panel--info" style={{ marginBottom: '15px' }}>
          <p style={{ margin: 0, color: 'white', fontSize: '0.9rem' }}>{t(narrowed ? modeDescKey : 'howto.winCondition')}</p>
        </div>

        {phaseKey && (
          <div className="panel panel--purple" style={{ marginBottom: '15px' }}>
            <h4 style={{ color: 'var(--neon-purple)', margin: '0 0 6px 0', fontSize: '0.85rem' }}>{t('howto.phaseNowTitle')}</h4>
            <p style={{ margin: 0, color: 'white', fontSize: '0.9rem' }}>{t(phaseKey)}</p>
          </div>
        )}

        <h4 style={{ color: 'var(--neon-purple)', margin: '0 0 4px 0' }}>{t('howto.rolesTitle')}</h4>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '12px' }}>
          {t(!narrowed ? 'howto.rolesIntro' : isPlayerContext ? 'howto.rolesIntroInRoundPlayer' : 'howto.rolesIntroInRoundGm')}
        </p>
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
