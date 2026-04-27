import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore.js';

export default function AccountPopover() {
  const open    = useAppStore((s) => s.accountPopoverOpen);
  const email   = useAppStore((s) => s.email);
  const close   = useAppStore((s) => s.closeAccountPopover);
  const signOut = useAppStore((s) => s.signOut);
  const ref     = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) close();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown',   onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown',   onKey);
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="popover account-popover" ref={ref} role="dialog" aria-label="Account">
      <div className="popover-eyebrow">Signed in as</div>
      <div className="popover-email">{email || '—'}</div>
      <hr className="popover-divider" />
      <button type="button" className="popover-action" onClick={signOut}>
        Sign Out
      </button>
    </div>
  );
}
