import React, { useEffect, useState } from 'react';

type Props = {
  value: number;
  onChange: (n: number) => void;
  /** Reported (and shown) when the field is emptied. Default 0. */
  emptyValue?: number;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onEnter?: () => void;
};

/**
 * A number input you can actually clear.
 *
 * A plain controlled `<input type="number" value={n}>` with an `|| 0`/`|| 1`
 * fallback can never be emptied: backspacing to "" immediately snaps back to
 * the default, so the cashier can't type a fresh value without selecting-all
 * first. This keeps the *typed text* as local state (so "" is allowed while
 * editing) and reports `emptyValue` for an empty field — the parent still gets
 * a clean number.
 */
export default function NumberField({
  value,
  onChange,
  emptyValue = 0,
  min,
  max,
  step,
  className,
  placeholder,
  autoFocus,
  disabled,
  onEnter,
}: Props) {
  const [text, setText] = useState<string>(value === emptyValue ? '' : String(value));

  // Reflect programmatic changes (reset to default after save, +/- buttons,
  // capped values) without clobbering what the user is mid-typing.
  useEffect(() => {
    const parsed = text.trim() === '' ? emptyValue : parseFloat(text);
    if (parsed !== value) setText(value === emptyValue ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="number"
      className={className}
      value={text}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        onChange(v.trim() === '' ? emptyValue : parseFloat(v) || emptyValue);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) onEnter();
      }}
    />
  );
}
