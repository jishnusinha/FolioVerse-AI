/** Icon set from the design prototype (24px grid, 1.7 stroke). */
const PATHS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  knowledge: 'M5 3h9l5 5v13H5zM14 3v5h5M8 13h8M8 17h5',
  writer: 'M20 4c-6 0-11 5-12 12l-2 4 4-2c7-1 12-6 12-12zM8 16l6-6',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-.8 3 15.6-3.5.8z',
  discover: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  studio:
    'M5 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 6h10M6 8l5 8M18 8l-5 8',
  costs:
    'M12 3v18M16.5 7.5c-.8-1.2-2.5-2-4.5-2-2.5 0-4 1.3-4 3s1.5 2.6 4 3 4 1.3 4 3-1.5 3-4 3c-2 0-3.7-.8-4.5-2',
  admin: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  docs: 'M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7z',
  settings: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  x: 'M6 6l12 12M18 6L6 18',
  chev: 'M9 6l6 6-6 6',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  panel: 'M3 4h18v16H3zM9 4v16',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  play: 'M7 4l13 8-13 8z',
  reset: 'M3 12a9 9 0 1 0 3-6.7M3 3v6h6',
  focus: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  lens: 'M12 3l2 6 6 .5-4.7 4 1.5 6.5L12 16.6 7.2 20l1.5-6.5L4 9.5 10 9z',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
  trash: 'M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};

export const ICON_NAMES = Object.keys(PATHS);

/** @param {{ name: keyof typeof PATHS, size?: number, className?: string }} props */
export function Icon({ name, size = 18, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke="var(--fv-accent)" strokeWidth="1.4" />
      <ellipse cx="16" cy="16" rx="14" ry="5" fill="none" stroke="var(--fv-ai-line)" transform="rotate(-24 16 16)" />
      <path
        d="M9 11c3-1 5-.5 7 1 2-1.5 4-2 7-1v11c-3-1-5-.5-7 1-2-1.5-4-2-7-1z"
        fill="var(--fv-surface)"
        stroke="var(--fv-text)"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M16 12v11" stroke="var(--fv-text)" />
    </svg>
  );
}
