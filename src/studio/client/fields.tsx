import { useEffect, useState, type FC, type ReactNode } from 'react';

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
