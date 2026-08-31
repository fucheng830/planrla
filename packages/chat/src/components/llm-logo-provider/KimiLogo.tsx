type KimiLogoProps = {
  className?: string;
};

const KimiLogo = ({ className = 'w-5 h-5' }: KimiLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label="Kimi Code"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2.5" y="2.5" width="19" height="19" rx="4" className="fill-foreground" />
    <path
      d="M8 6.8v10.4M8 12.6l6.8-5.8M9.4 11.4l5.9 5.8"
      className="stroke-background"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default KimiLogo;
