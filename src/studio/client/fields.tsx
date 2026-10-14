import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';

/** A text input that commits on Enter or blur; empty commits null. */
export const TextField: FC<{
  field: string;
  value: string | undefined;
  placeholder?: string;
  multiline?: boolean;
  onCommit: (value: string | null) => void;
}> = ({ field, value, placeholder, multiline, onCommit }) => {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const commit = () => {
    const next = text.trim();
    if (next !== (value ?? '')) onCommit(next || null);
  };
  const props = {
    'data-field': field,
    value: text,
    placeholder,
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: commit,
  };
  return multiline ? (
    <textarea
      {...props}
      rows={3}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
      }}
    />
  ) : (
    <input
      {...props}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
};

export const Row: FC<{ label: string; hint?: string; children: ReactNode }> = ({ label, hint, children }) => (
  <label className="row">
    <span className="label">
      {label}
      {hint ? <small>{hint}</small> : null}
    </span>
    {children}
  </label>
);

/**
 * A colour picker that saves once, when a pick is made (the native `change` event), not on every
 * step of a drag (React's onChange is the `input` event) and not on focus or blur. `value` may be
 * any CSS colour; the swatch shows it when it is a #rrggbb, else `fallback`.
 */
export const ColorInput: FC<{ field: string; value: string | undefined; fallback?: string; onCommit: (value: string) => void }> = ({
  field,
  value,
  fallback = '#6366f1',
  onCommit,
}) => {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const done = () => commit.current(el.value);
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, []);
  const hex = (v: string | undefined) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);
  const shown = hex(value) ?? hex(fallback) ?? '#6366f1';
  return <input ref={ref} type="color" data-field={field} defaultValue={shown} key={shown} />;
};
