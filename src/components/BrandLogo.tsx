type BrandLogoProps = {
  className?: string;
};

/** The supplied artwork is kept intact, including its background and lettering. */
export function BrandLogo({ className = "" }: BrandLogoProps) {
  return <img className={className} src="/assets/shashlik-like-approved-logo.png" width="1254" height="1254" alt="ШашлычОК · Шашлык Лайк" decoding="async" />;
}
