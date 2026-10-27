import { useCallback, useEffect, useRef, useState } from 'react';

export function toSpeechText(text: string) {
  // Some macOS/Chrome voices pronounce a trailing ASCII period as "dot"
  // even when the utterance language is Korean. Keep punctuation in the UI,
  // but omit sentence-ending marks from the synthesized text.
  return text.trim().replace(/[.。]+$/u, '').trim();
}

export function useSpeech() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState(() => { try { return localStorage.getItem('eyecan.aac.voice') || ''; } catch { return ''; } });
  const [status, setStatus] = useState('음성 대기');
  const generation = useRef(0);
  const stopPending = useRef<(() => void) | null>(null);
  const cancel = useCallback(() => {
    generation.current++; stopPending.current?.(); stopPending.current = null;
    window.speechSynthesis?.cancel(); setStatus('음성 대기');
  }, []);
  useEffect(() => {
    const synth = window.speechSynthesis;
    const refresh = () => setVoices(synth?.getVoices().filter(v => /^ko(?:[-_]|$)/i.test(v.lang)) ?? []);
    refresh(); synth?.addEventListener('voiceschanged', refresh);
    window.addEventListener('pagehide', cancel);
    return () => { synth?.removeEventListener('voiceschanged', refresh); window.removeEventListener('pagehide', cancel); cancel(); };
  }, [cancel]);
  const chooseVoice = (uri: string) => { setVoiceURI(uri); try { localStorage.setItem('eyecan.aac.voice', uri); } catch { /* Storage may be disabled. */ } };
  const speak = useCallback((text: string, onStart: () => void): Promise<'ended' | 'cancelled'> => {
    cancel();
    const synth = window.speechSynthesis;
    const available = synth?.getVoices().filter(v => /^ko(?:[-_]|$)/i.test(v.lang)) ?? [];
    const voice = available.find(v => v.voiceURI === voiceURI) ?? available.find(v => v.default) ?? available[0];
    if (!synth || !voice) return Promise.reject(new Error('한국어 음성을 사용할 수 없습니다. 보조자 설정에서 확인해주세요.'));
    const id = generation.current;
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(toSpeechText(text));
      utterance.voice = voice; utterance.lang = voice.lang || 'ko-KR'; utterance.rate = .9; utterance.volume = 1;
      let settled = false, startTimer = 0, endTimer = 0;
      const finish = (result: 'ended' | 'cancelled' | Error) => {
        if (settled) return;
        settled = true; clearTimeout(startTimer); clearTimeout(endTimer);
        stopPending.current = null;
        if (result instanceof Error) { generation.current++; synth.cancel(); setStatus(result.message); reject(result); }
        else resolve(result);
      };
      stopPending.current = () => finish('cancelled');
      utterance.onstart = () => { if (generation.current !== id || settled) return; clearTimeout(startTimer); setStatus('음성 출력 중'); onStart(); };
      utterance.onend = () => { if (generation.current !== id || settled) return; setStatus('음성 출력 완료'); finish('ended'); };
      utterance.onerror = () => { if (generation.current === id) finish(new Error('음성 출력에 실패했습니다. 다시 선택해주세요.')); };
      startTimer = window.setTimeout(() => finish(new Error('음성 시작 시간 초과')), 5000);
      endTimer = window.setTimeout(() => finish(new Error('음성 출력 시간 초과')), 20000);
      setStatus('음성 시작 대기');
      try { synth.speak(utterance); } catch { finish(new Error('음성을 시작하지 못했습니다')); }
    });
  }, [cancel, voiceURI]);
  return { voices, voiceURI, chooseVoice, status, speak, cancel };
}
