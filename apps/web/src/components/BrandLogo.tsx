type Props = { variant?: 'horizontal' | 'stacked' | 'symbol'; tone?: 'default' | 'light' | 'mono' };

export function BrandLogo({ variant = 'horizontal', tone = 'default' }: Props) {
  return <span className={`brand-logo brand-logo--${variant} brand-logo--${tone}`} aria-label="EyeCan Room">
    <img className="brand-image" src="/brand/eyecan-room-final-logo.png" alt="" />
  </span>;
}
