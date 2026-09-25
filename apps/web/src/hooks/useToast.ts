import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToastState, ToastTone } from '../types/control';

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);
  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ id: ++nextId.current, message, tone });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(dismiss, toast.tone === 'error' ? 7000 : 4000);
    return () => window.clearTimeout(id);
  }, [toast, dismiss]);
  return { toast, notify, dismiss };
}
