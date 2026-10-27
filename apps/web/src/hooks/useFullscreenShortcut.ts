import { useEffect } from 'react';

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
}

export function useFullscreenShortcut() {
  useEffect(() => {
    const enterFullscreen = (event: KeyboardEvent) => {
      const isFullscreenKey = event.code === 'KeyF' || event.key.toLowerCase() === 'f';
      if (!isFullscreenKey || event.repeat || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
      if (document.fullscreenElement) return;
      event.preventDefault();
      void document.documentElement.requestFullscreen().catch(() => {
        // Fullscreen can be denied by browser or operating-system policy.
      });
    };
    document.addEventListener('keydown', enterFullscreen);
    return () => document.removeEventListener('keydown', enterFullscreen);
  }, []);
}
