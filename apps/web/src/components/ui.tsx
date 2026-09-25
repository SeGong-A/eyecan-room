import { AlertCircle, LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; busy?: boolean; icon?: ReactNode;
};

export function Button({ variant = 'primary', busy = false, icon, className = '', children, disabled, ...props }: ButtonProps) {
  return <button type="button" {...props} disabled={disabled || busy} aria-busy={busy || undefined} className={`button button--${variant} ${className}`}>
    {busy ? <LoaderCircle className="loading-icon" size={20} aria-hidden="true" /> : icon}<span>{children}</span>
  </button>;
}

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" {...props} aria-label={label} className={`icon-button ${className}`}>
    {children}<span className="icon-tooltip" aria-hidden="true">{label}</span>
  </button>;
}

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'error' }) {
  return <span className={`status-badge status-badge--${tone}`}><span className="status-dot" aria-hidden="true" />{children}</span>;
}

export function ErrorState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="error-state" role="alert"><AlertCircle size={20} aria-hidden="true" /><div><strong>{title}</strong><p>{children}</p></div></div>;
}
