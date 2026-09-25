type Props = { variant?: 'horizontal' | 'stacked' | 'symbol'; tone?: 'default' | 'light' | 'mono' };

export function BrandLogo({ variant = 'horizontal', tone = 'default' }: Props) {
  return <span className={`brand-logo brand-logo--${variant} brand-logo--${tone}`} aria-label="EyeCan Room">
    <svg className="brand-symbol" viewBox="0 0 64 64" aria-hidden="true"><use href="/brand/eyecan.svg#mark" /></svg>
    {variant !== 'symbol' && <span className="brand-wordmark">EyeCan <span>Room</span></span>}
  </span>;
}
