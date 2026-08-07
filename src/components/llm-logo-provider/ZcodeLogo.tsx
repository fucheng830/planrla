type ZcodeLogoProps = {
  className?: string;
};

/**
 * ZCode (Z.AI) logo mark. Stylised "Z" on a rounded square, using theme tokens
 * so it adapts to light/dark like the other provider logos.
 */
const ZcodeLogo = ({ className = 'w-5 h-5' }: ZcodeLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label="ZCode"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2.5" y="2.5" width="19" height="19" rx="4" className="fill-foreground" />
    <path
      d="M8.5 8.2h7l-6.4 6.1c-.4.4-.1 1.1.5 1.1H15.5"
      className="stroke-background"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);

export default ZcodeLogo;
