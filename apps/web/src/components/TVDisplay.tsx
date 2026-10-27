import { useEffect, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import type { TVState } from '../types/control';
import { Button } from './ui';

const initialTV: TVState = { power: true, channel: 1, volume: 50, mute: false, revision: 0 };
const channels = [
  { number: 1, name: '자연', className: 'tv-channel--care', media: '/tv/channels/channel_01_nature.mp4', poster: '/tv/channels/channel_01_nature.jpg' },
  { number: 2, name: '바다', className: 'tv-channel--room', media: '/tv/channels/channel_02_ocean.mp4', poster: '/tv/channels/channel_02_ocean.jpg' },
  { number: 3, name: '산', className: 'tv-channel--rest', media: '/tv/channels/channel_03_mountain.mp4', poster: '/tv/channels/channel_03_mountain.jpg' }
] as const;

export function TVDisplay() {
  const [tv, setTV] = useState<TVState>(initialTV);
  const [connected, setConnected] = useState(false);
  const [mediaBlocked, setMediaBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const channel = channels[tv.channel - 1] ?? channels[0];

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryId = 0;
    let disposed = false;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(`${protocol}://${window.location.host}/ws/state`);
      socket.addEventListener('open', () => setConnected(true));
      socket.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data) as { tv?: TVState; last_command?: string };
          if (payload.tv) {
            setTV(payload.tv);
          }
        } catch {
          setConnected(false);
        }
      });
      socket.addEventListener('close', () => {
        setConnected(false);
        if (!disposed) retryId = window.setTimeout(connect, 1000);
      });
      socket.addEventListener('error', () => setConnected(false));
    };
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retryId);
      socket?.close();
    };
  }, []);

  useEffect(() => {
    const media = videoRef.current;
    if (!media) return;
    if (!tv.power) {
      media.pause();
      return;
    }
    void media.play().then(() => setMediaBlocked(false)).catch(() => setMediaBlocked(true));
  }, [tv.channel, tv.power]);

  async function enterFullscreen() {
    try { await document.documentElement.requestFullscreen(); }
    catch { /* Browser keeps the window usable when fullscreen is denied. */ }
  }

  if (!tv.power) return <main className="tv-display tv-display--off" aria-label="TV 전원 꺼짐" />;

  return <main className={`tv-display ${channel.className}`} style={{ backgroundImage: `url(${channel.poster})` }}>
    <video key={channel.number} ref={videoRef} className="tv-media" src={channel.media} poster={channel.poster}
      aria-label={`CH ${channel.number} ${channel.name}`} autoPlay loop muted playsInline preload="auto" />
    <header className="tv-display-header">
      <span className={`tv-sync ${connected ? 'is-connected' : ''}`}>{connected ? '제어 연결됨' : '제어 재연결 중'}</span>
      <Button variant="secondary" icon={<Maximize2 size={18} aria-hidden="true" />} onClick={() => void enterFullscreen()}>전체 화면</Button>
    </header>
    {mediaBlocked && <Button className="tv-play-button" onClick={() => void videoRef.current?.play().then(() => setMediaBlocked(false))}>영상 재생 시작</Button>}
  </main>;
}
