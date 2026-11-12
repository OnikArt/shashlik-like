import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "secondary" | "quiet"; loading?: boolean };

export const UrbanButton = forwardRef<HTMLButtonElement, ButtonProps>(function UrbanButton({ tone = "primary", loading = false, disabled, className = "", children, ...props }, ref) {
  return <button {...props} ref={ref} disabled={disabled || loading} aria-busy={loading} className={`urban-button urban-button--${tone} ${className}`.trim()}>{loading && <span className="urban-button-spinner" aria-hidden="true" />}{children}</button>;
});

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string };

export const UrbanField = forwardRef<HTMLInputElement, FieldProps>(function UrbanField({ label, hint, error, className = "", id, ...props }, ref) {
  return <label className={`urban-field ${className}`.trim()} htmlFor={id}><span>{label}</span><input {...props} id={id} ref={ref} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} />{error ? <small id={`${id}-error`} role="alert">{error}</small> : hint ? <small id={`${id}-hint`}>{hint}</small> : null}</label>;
});
