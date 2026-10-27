import { ArrowLeft, CupSoda, HandHelping, MessageCircle, Trash2, Droplets, Square, BottleWine, Smartphone, Phone, BatteryCharging } from 'lucide-react';
import type { CommandItem, ScanTarget, TargetMeta } from '../types/control';
import { aacObjectTypes, type AacObjectType } from '../types/aac';
import { targetMeta } from './control';

export const objectNames: Record<AacObjectType, string> = { cup: '물컵', bottle: '물병', cell_phone: '핸드폰', tissue_box: '휴지' };
export const objectOrder: readonly AacObjectType[] = aacObjectTypes;
const objectIcons: Record<AacObjectType, CommandItem['icon']> = { cup: CupSoda, bottle: BottleWine, cell_phone: Smartphone, tissue_box: Square };
export const aacMeta = { name: '의사소통', icon: MessageCircle };
export const contextMeta: TargetMeta = { name: '대상 선택', icon: MessageCircle };
export const aacBack: CommandItem = { id: 'aac-back', command: 'AAC_BACK', label: '뒤로', description: '이전 화면', icon: ArrowLeft };
export const aacRequests: Record<AacObjectType, CommandItem[]> = {
  cup: [
    { command: 'CUP_DRINK', label: '물 마시기', description: '물 마시고 싶어요.', icon: CupSoda },
    { command: 'CUP_REFILL', label: '물 채우기', description: '물을 채워주세요.', icon: Droplets },
    { command: 'CUP_REMOVE', label: '컵 치우기', description: '컵을 치워주세요.', icon: Trash2 }, aacBack
  ],
  bottle: [
    { command: 'BOTTLE_GIVE', label: '물병 요청', description: '물병을 주세요.', icon: BottleWine },
    { command: 'BOTTLE_OPEN', label: '뚜껑 열기', description: '물병 뚜껑을 열어주세요.', icon: HandHelping },
    { command: 'BOTTLE_REMOVE', label: '물병 치우기', description: '물병을 치워주세요.', icon: Trash2 }, aacBack
  ],
  cell_phone: [
    { command: 'PHONE_GIVE', label: '핸드폰 요청', description: '핸드폰을 주세요.', icon: Smartphone },
    { command: 'PHONE_CALL', label: '전화 요청', description: '전화를 걸어주세요.', icon: Phone },
    { command: 'PHONE_CHARGE', label: '충전 요청', description: '핸드폰을 충전해주세요.', icon: BatteryCharging }, aacBack
  ],
  tissue_box: [
    { command: 'TISSUE_GIVE', label: '휴지 요청', description: '휴지를 주세요.', icon: Square },
    { command: 'TISSUE_HELP', label: '코 닦기', description: '코를 닦는 것을 도와주세요.', icon: HandHelping },
    { command: 'TISSUE_REMOVE', label: '휴지 치우기', description: '사용한 휴지를 치워주세요.', icon: Trash2 }, aacBack
  ]
};
export function objectItems(types: AacObjectType[]): CommandItem[] {
  return [...objectOrder.filter(type => types.includes(type)).map(type => ({
    id: `object-${type}`, command: `AAC_OBJECT_${type}`, label: objectNames[type], description: `${objectNames[type]} 요청`, icon: objectIcons[type]
  })), aacBack];
}
export function contextItems(target: ScanTarget, types: AacObjectType[]): CommandItem[] {
  const device = targetMeta[target];
  return [
    { id: `context-device-${target}`, command: `CONTEXT_DEVICE_${target}`, label: device.name, description: `${device.name} 제어`, icon: device.icon },
    ...objectOrder.filter(type => types.includes(type)).map(type => ({
      id: `context-object-${type}`, command: `CONTEXT_OBJECT_${type}`, label: objectNames[type], description: `${objectNames[type]} 요청`, icon: objectIcons[type]
    })),
    { id: 'context-back', command: 'CONTEXT_BACK', label: '뒤로', description: '방 화면으로 돌아갑니다', icon: ArrowLeft }
  ];
}
export function inAacZone(pan: number, tilt: number, maintained = false): boolean {
  return Number.isFinite(pan) && Number.isFinite(tilt) && pan > 147 && pan < 157 && tilt >= (maintained ? 21 : 25);
}
