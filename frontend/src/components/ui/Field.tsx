import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

interface BaseProps {
  label?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
}

function Wrapper({
  label,
  error,
  hint,
  required,
  children,
}: BaseProps & { children: ReactNode }) {
  return (
    <div>
      {label && (
        <label className="label-base">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      {children}
      {error && <p className="mt-1 text-xs font-medium text-rose-600">{error}</p>}
      {!error && hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Input({
  label,
  error,
  hint,
  required,
  className = '',
  ...rest
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Wrapper label={label} error={error} hint={hint} required={required}>
      <input
        {...rest}
        required={required}
        className={`input-base ${error ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20' : ''} ${className}`}
      />
    </Wrapper>
  );
}

export function Textarea({
  label,
  error,
  hint,
  required,
  className = '',
  ...rest
}: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Wrapper label={label} error={error} hint={hint} required={required}>
      <textarea {...rest} required={required} className={`input-base resize-y ${className}`} />
    </Wrapper>
  );
}

export function Select({
  label,
  error,
  hint,
  required,
  children,
  className = '',
  ...rest
}: BaseProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Wrapper label={label} error={error} hint={hint} required={required}>
      <select {...rest} required={required} className={`input-base ${className}`}>
        {children}
      </select>
    </Wrapper>
  );
}

export function Checkbox({
  label,
  className = '',
  ...rest
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`flex cursor-pointer select-none items-center gap-2 text-sm text-slate-700 ${className}`}>
      <input
        type="checkbox"
        {...rest}
        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
      />
      {label}
    </label>
  );
}
