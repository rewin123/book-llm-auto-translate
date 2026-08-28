type Props = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor' as const,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
});

export function BookIcon({ size = 19, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={1.5} className={className}>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22z" />
      <path d="M4 17.5h16" />
    </svg>
  );
}

export function CheckIcon({ size = 15, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2.6} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function CrossIcon({ size = 15, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2.4} className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function WarnIcon({ size = 15, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

export function InfoIcon({ size = 15, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

export function AlertIcon({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5h.01" />
    </svg>
  );
}

export function OfflineIcon({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <path d="M2 8.8a16 16 0 0 1 20 0" />
      <path d="M5 12.5a11 11 0 0 1 14 0" />
      <path d="M8.5 16a6 6 0 0 1 7 0" />
      <path d="M12 20h.01" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

export function ClockIcon({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function BlockIcon({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </svg>
  );
}

export function ChevronDown({ size = 14, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChevronRight({ size = 14, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function ChevronLeft({ size = 14, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function ArrowRight({ size = 16, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function SwapIcon({ size = 16, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={1.8} className={className}>
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </svg>
  );
}

export function SearchIcon({ size = 14, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function PauseIcon({ size = 14, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <path d="M9 4v16M15 4v16" />
    </svg>
  );
}

export function StopIcon({ size = 14, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

export function PlayIcon({ size = 14, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <path d="M7 4.5v15l12-7.5z" />
    </svg>
  );
}

export function DownloadIcon({ size = 16, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 21h16" />
    </svg>
  );
}

export function PlusIcon({ size = 14, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2.2} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function TrashIcon({ size = 14, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={1.9} className={className}>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 13h10l1-13" />
    </svg>
  );
}

export function SunIcon({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={1.6} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} strokeWidth={1.6} className={className}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
  );
}
