import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';

interface FieldChrome {
  label?: React.ReactNode;
  /** Helper text under the control. */
  hint?: React.ReactNode;
  /** Validation message. When set, the control is drawn in the alarm colour and `aria-invalid`. */
  error?: React.ReactNode;
  /** Marks the label with a required indicator (also sets the `required` attribute). */
  required?: boolean;
  /** Wrapper class for the whole field (label + control + hint). */
  fieldClassName?: string;
}

// h-11 tracks Button's `md`. These sit next to each other in every form and in
// every modal footer, so the two heights are one decision, not two.
const CONTROL =
  'w-full h-11 px-3 text-sm rounded-lg bg-bg-lowest text-text-primary placeholder:text-text-muted border transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-cyan/40 disabled:opacity-50 disabled:cursor-not-allowed';
const CONTROL_OK = 'border-border-color focus:border-cyan';
const CONTROL_ERR = 'border-red focus:border-red focus:ring-red/30';

function Label({ htmlFor, required, children }: { htmlFor: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-text-secondary mb-1.5">
      {children}
      {required && <span className="text-red ml-0.5" aria-hidden>*</span>}
    </label>
  );
}

function Below({ id, hint, error }: { id: string; hint?: React.ReactNode; error?: React.ReactNode }) {
  if (!hint && !error) return null;
  return (
    <p id={id} className={cn('mt-1.5 text-xs', error ? 'text-red' : 'text-text-muted')} role={error ? 'alert' : undefined}>
      {error || hint}
    </p>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement>, FieldChrome {
  /** Element drawn inside the control on the left (e.g. a lucide icon). */
  leading?: React.ReactNode;
  /** Element drawn inside the control on the right (e.g. a unit suffix). */
  trailing?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, required, fieldClassName, leading, trailing, className, id: idProp, ...rest },
  ref
) {
  const auto = useId();
  const id = idProp ?? auto;
  const descId = `${id}-desc`;
  return (
    <div className={fieldClassName}>
      {label && <Label htmlFor={id} required={required}>{label}</Label>}
      <div className="relative">
        {leading && <span className="absolute inset-y-0 left-3 flex items-center text-text-muted pointer-events-none">{leading}</span>}
        <input
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? descId : undefined}
          className={cn(CONTROL, error ? CONTROL_ERR : CONTROL_OK, leading && 'pl-9', trailing && 'pr-10', className)}
          {...rest}
        />
        {trailing && <span className="absolute inset-y-0 right-3 flex items-center text-text-muted text-xs pointer-events-none">{trailing}</span>}
      </div>
      <Below id={descId} hint={hint} error={error} />
    </div>
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement>, FieldChrome {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, required, fieldClassName, className, id: idProp, rows = 3, ...rest },
  ref
) {
  const auto = useId();
  const id = idProp ?? auto;
  const descId = `${id}-desc`;
  return (
    <div className={fieldClassName}>
      {label && <Label htmlFor={id} required={required}>{label}</Label>}
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? descId : undefined}
        className={cn(CONTROL, 'h-auto py-2 resize-y', error ? CONTROL_ERR : CONTROL_OK, className)}
        {...rest}
      />
      <Below id={descId} hint={hint} error={error} />
    </div>
  );
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement>, FieldChrome {}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, required, fieldClassName, className, id: idProp, children, ...rest },
  ref
) {
  const auto = useId();
  const id = idProp ?? auto;
  const descId = `${id}-desc`;
  return (
    <div className={fieldClassName}>
      {label && <Label htmlFor={id} required={required}>{label}</Label>}
      <div className="relative">
        <select
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? descId : undefined}
          className={cn(CONTROL, 'appearance-none pr-9 cursor-pointer', error ? CONTROL_ERR : CONTROL_OK, className)}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" aria-hidden />
      </div>
      <Below id={descId} hint={hint} error={error} />
    </div>
  );
});
