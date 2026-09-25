import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, Eye } from 'lucide-react';
import type { CommandItem, TargetMeta } from '../types/control';
import { Button } from './ui';

type Props = {
  activeScanStep: number; rotationStep: number; currentItem: CommandItem; radialTarget: TargetMeta;
  scanIntervalMs: number; scanList: CommandItem[]; paused: boolean; busy: boolean; status?: string; onSelectCurrent: () => void;
};

export function RadialControl({ activeScanStep, rotationStep, currentItem, radialTarget, scanIntervalMs, scanList, paused, busy, status, onSelectCurrent }: Props) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [radius, setRadius] = useState(112);
  useLayoutEffect(() => {
    const node = areaRef.current;
    if (!node) return;
    const resize = () => {
      const compact = window.matchMedia('(max-width: 600px), (max-height: 650px)').matches;
      const halfWidth = compact ? 44 : 60;
      const halfHeight = compact ? 32 : 36;
      setRadius(Math.max(112, Math.min(200, node.clientWidth / 2 - halfWidth - 4, node.clientHeight / 2 - halfHeight - 8)));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    resize();
    return () => observer.disconnect();
  }, []);
  const rotation = -rotationStep * (360 / scanList.length);
  const TargetIcon = radialTarget.icon;

  return <section className="radial-overlay" aria-label={`${radialTarget.name} 선택 메뉴`}>
    <div className="radial-area" ref={areaRef} style={{ '--wheel-radius': `${radius}px` } as CSSProperties}>
      <div className="radial-orbit" aria-hidden="true" />
      <div className="command-wheel" style={{ '--wheel-rotation': `${rotation}deg` } as CSSProperties}>
        {scanList.map((item, index) => {
          const angle = index * 2 * Math.PI / scanList.length;
          const Icon = item.icon;
          return <div key={item.command} className={`radial-command ${index === activeScanStep ? 'active' : ''}`}
            data-command={item.command} aria-current={index === activeScanStep ? 'true' : undefined}
            style={{ '--item-x': `${Math.sin(angle) * radius}px`, '--item-y': `${-Math.cos(angle) * radius}px`, '--counter-rotation': `${-rotation}deg` } as CSSProperties}>
            <Icon size={22} strokeWidth={1.8} aria-hidden="true" /><strong>{item.label}</strong>
          </div>;
        })}
      </div>
      <div className="radial-center"><TargetIcon size={30} strokeWidth={1.6} aria-hidden="true" /><h2>{radialTarget.name}</h2><span>{status ?? `${activeScanStep + 1} / ${scanList.length}`}</span></div>
      <svg className="radial-timer" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56" />
        <circle key={`${rotationStep}-${scanIntervalMs}`} className="timer-progress" cx="60" cy="60" r="56"
          style={{ animationDuration: `${scanIntervalMs}ms`, animationPlayState: paused ? 'paused' : 'running' }} />
      </svg>
    </div>
    <div className="radial-current"><div className="current-command"><Eye size={22} aria-hidden="true" /><div><span>{paused ? '선택 일시정지' : '현재 선택'}</span><strong aria-live="polite" aria-atomic="true">{currentItem.label}</strong></div></div>
      <Button onClick={onSelectCurrent} disabled={paused} busy={busy} icon={<Check size={20} aria-hidden="true" />}>선택</Button>
    </div>
  </section>;
}
