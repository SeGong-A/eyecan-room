import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import type { ToastState } from '../types/control';
import { IconButton } from './ui';

export function AppToast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  if (!toast) return null;
  const Icon = toast.tone === 'error' ? CircleAlert : toast.tone === 'success' ? CircleCheck : Info;
  return <div key={toast.id} className={`toast toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
    <Icon size={22} aria-hidden="true" /><span>{toast.message}</span>
    <IconButton label="알림 닫기" onClick={onDismiss}><X size={18} aria-hidden="true" /></IconButton>
  </div>;
}
