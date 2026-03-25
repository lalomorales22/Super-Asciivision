export function AppMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="appmark-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0a0a0f" />
          <stop offset="100%" stopColor="#050508" />
        </linearGradient>
        <linearGradient id="appmark-a" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff6ef9" />
          <stop offset="30%" stopColor="#a855f7" />
          <stop offset="60%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="224" fill="url(#appmark-bg)" />
      {/* "s" — white */}
      <path d="M390 395c-55 0-100 40-100 90s35 72 88 85c35 9 52 22 52 42 0 25-22 43-55 43-38 0-65-18-82-45l-40 35c28 40 72 62 120 62 65 0 112-42 112-97 0-52-32-75-92-90-33-8-48-20-48-38 0-22 18-38 48-38 30 0 52 14 68 36l38-34c-24-32-62-51-109-51z" fill="#ffffff" opacity="0.95" transform="translate(30,120) scale(0.85)" />
      {/* "A" — rainbow gradient matching ASCIIVISION button */}
      <path d="M180 680h-58L230 200h65l108 480h-58l-26-120H206zm22-168h96l-48-222z" fill="url(#appmark-a)" transform="translate(430,0) scale(1.0)" />
    </svg>
  );
}
