import { ArrowRight } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { Button } from './ui';

export function HomeScreen({ onStart }: { onStart: () => void }) {
  return <section className="home-screen" id="main-view">
    <div className="home-content">
      <h1><BrandLogo variant="stacked" /></h1>
      <Button className="home-start" onClick={onStart} icon={<ArrowRight size={20} aria-hidden="true" />}>시작하기</Button>
    </div>
  </section>;
}
