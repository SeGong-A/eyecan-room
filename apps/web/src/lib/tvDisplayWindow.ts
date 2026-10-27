type ScreenDetailsLike = {
  currentScreen?: { id?: string };
  screens: Array<{ id?: string; isPrimary?: boolean; availLeft: number; availTop: number; availWidth: number; availHeight: number }>;
};

type WindowWithScreenDetails = Window & {
  getScreenDetails?: () => Promise<ScreenDetailsLike>;
};

export type TVWindowResult = { ok: boolean; placed: boolean; message: string };

export async function openTVDisplayWindow(): Promise<TVWindowResult> {
  const popup = window.open('/tv-display', 'eyecan-tv-display', 'popup,width=1280,height=720');
  if (!popup) return { ok: false, placed: false, message: '팝업이 차단되었습니다. 브라우저에서 팝업을 허용해주세요.' };

  const managedWindow = window as WindowWithScreenDetails;
  if (!managedWindow.getScreenDetails) {
    return { ok: true, placed: false, message: 'TV 창을 열었습니다. 포터블 모니터로 옮긴 뒤 전체 화면을 눌러주세요.' };
  }

  try {
    const details = await managedWindow.getScreenDetails();
    const target = details.screens.find((screen) => screen.id !== details.currentScreen?.id && !screen.isPrimary)
      ?? details.screens.find((screen) => screen.id !== details.currentScreen?.id);
    if (!target) return { ok: true, placed: false, message: 'TV 창을 열었습니다. 확장 모니터가 감지되면 창을 직접 옮겨주세요.' };
    popup.moveTo(target.availLeft, target.availTop);
    popup.resizeTo(target.availWidth, target.availHeight);
    popup.focus();
    return { ok: true, placed: true, message: 'TV 화면을 확장 모니터에 열었습니다. TV 창에서 전체 화면을 눌러주세요.' };
  } catch {
    return { ok: true, placed: false, message: 'TV 창을 열었습니다. 화면 관리 권한이 없어 창을 직접 옮겨주세요.' };
  }
}
