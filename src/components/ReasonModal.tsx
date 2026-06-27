import React, { useEffect, useState } from 'react';

type Props = {
  title: string;
  message?: string;
  /** Show the reason textarea. When false this is a plain confirm dialog. */
  showReason?: boolean;
  reasonLabel?: string;
  reasonRequired?: boolean;
  /** Quick-pick reasons shown as buttons above the textarea. */
  reasonOptions?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
};

/**
 * Confirm-with-optional-reason dialog. Replaces window.prompt(), which Electron
 * does not support (it throws), so any flow relying on prompt() silently fails.
 */
export default function ReasonModal({
  title,
  message,
  showReason = true,
  reasonLabel = 'Reason (optional)',
  reasonRequired = false,
  reasonOptions,
  confirmLabel,
  cancelLabel = 'Keep',
  danger = true,
  onConfirm,
  onClose,
}: Props) {
  const [reason, setReason] = useState('');
  const canConfirm = !showReason || !reasonRequired || reason.trim().length > 0;

  // Esc closes; Enter confirms a plain confirm dialog (no reason field). For
  // reason dialogs, Enter types a newline — use Ctrl/Cmd+Enter to confirm.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && (!showReason || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (canConfirm) onConfirm(reason.trim());
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showReason, canConfirm, reason, onConfirm, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{title}</h2>
        {message && <p className="text-sm text-stone-600">{message}</p>}
        {showReason && (
          <div className="space-y-2">
            <label className="text-xs text-stone-600">{reasonLabel}</label>
            {reasonOptions && reasonOptions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {reasonOptions.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setReason(opt)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      reason === opt
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-stone-300 text-stone-700 hover:bg-stone-50'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
            <textarea
              className="input"
              rows={2}
              value={reason}
              autoFocus
              placeholder={reasonOptions?.length ? 'Pick a reason above or type your own' : ''}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost border border-stone-300" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            className={danger ? 'btn-primary bg-rose-600 hover:bg-rose-700' : 'btn-primary'}
            disabled={!canConfirm}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
