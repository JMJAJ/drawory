import type { SVGProps } from "react";

export const ICONS = {
  hand: "M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15",
  select: "M4 4l7 17 2.5-7.4L21 11z",
  pen: "M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",
  eraser: "M7 21l-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21M22 21H7M5 11l9 9",
  rect: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
  ellipse: "M12 4c4.4 0 8 3.6 8 8s-3.6 8-8 8-8-3.6-8-8 3.6-8 8-8z",
  arrow: "M5 19L19 5M9 5h10v10",
  text: "M4 7V4h16v3M9 20h6M12 4v16",
  note: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  image: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM21 15l-5-5L5 21M9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  youtube: "M2.5 7.1a2.5 2.5 0 0 1 1.8-1.8C5.9 5 12 5 12 5s6.1 0 7.7.3a2.5 2.5 0 0 1 1.8 1.8c.4 1.6.4 4.9.4 4.9s0 3.3-.4 4.9a2.5 2.5 0 0 1-1.8 1.8C18.1 19 12 19 12 19s-6.1 0-7.7-.3a2.5 2.5 0 0 1-1.8-1.8C2 15.3 2 12 2 12s0-3.3.5-4.9zM10 15l5-3-5-3z",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  capsule: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3 7l9 6 9-6",
  heart: "M12 21l-7.5-7.3C2.6 11.9 2 10.5 2 8.6 2 5.5 4.4 3 7.4 3c1.8 0 3.4.9 4.6 2.4C13.2 3.9 14.8 3 16.6 3 19.6 3 22 5.5 22 8.6c0 1.9-.6 3.3-2.5 5.1z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2",
  lock: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4",
  unlock: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 7.9-1",
  sync: "M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M3 21v-5h5",
  pin: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  menu: "M4 6h16M4 12h16M4 18h16",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  undo: "M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13",
  redo: "M21 7v6h-6M3 17a9 9 0 0 1 15-6.7L21 13",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4",
  moon: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z",
  close: "M6 6l12 12M18 6L6 18",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
  front: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
  external: "M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  back: "M19 12H5M12 19l-7-7 7-7",
  check: "M5 12l5 5L20 7",
  play: "M8 5v14l11-7z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  stop: "M6 6h12v12H6z",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  stickynote: "M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8zM15 3v6h6M7 10h6M7 14h9",
  smile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
  crop: "M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2",
  calendar: "M4 5h16v16H4zM4 9h16M8 3v4M16 3v4",
  coins: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2",
  columns: "M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  map: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  group: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 8h5v5H8zM11 11h5v5h-5z",
  ungroup: "M4 4h7v7H4zM13 13h7v7h-7z",
  copy: "M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  window: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM3 9h18M12 9v11",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  poll: "M4 20h16M7 16v-6M12 16V5M17 16v-4",
  divider: "M3 12h18M8 6h8M8 18h8",
  grip: "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
  chevronUp: "M6 15l6-6 6 6",
  chevronDown: "M6 9l6 6 6-6",
  vote: "M12 4l7 8h-4v8H9v-8H5z",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  textLeft: "M4 6h16M4 12h10M4 18h14",
  textCenter: "M4 6h16M7 12h10M5 18h14",
  textRight: "M4 6h16M10 12h10M6 18h14",
  alignLeft: "M4 3v18M8 6h10v4H8zM8 14h6v4H8z",
  alignCenter: "M12 3v18M6 6h12v4H6zM8 14h8v4H8z",
  alignRight: "M20 3v18M6 6h10v4H6zM10 14h6v4h-6z",
  alignTop: "M3 4h18M6 8h4v10H6zM14 8h4v6h-4z",
  alignMiddle: "M3 12h18M6 6h4v12H6zM14 8h4v8h-4z",
  alignBottom: "M3 20h18M6 6h4v10H6zM14 10h4v6h-4z",
  spreadAcross: "M4 3v18M20 3v18M10 7h4v10h-4z",
  spreadDown: "M3 4h18M3 20h18M7 10h10v4H7z",
  volume: "M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14",
  mute: "M11 5L6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  wave: "M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15M3.6 8.6A6 6 0 0 1 5 4.2M1.6 6A9 9 0 0 1 3.4 2.2",
  sticker: "M15 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9zM15 21v-3a3 3 0 0 1 3-3h3M9 10h.01M15 10h.01M9 14.5c1.5 1.2 4 1.2 5.5 0",
} as const;

export type IconName = keyof typeof ICONS;

const FILLED: IconName[] = ["play", "pause", "stop"];

export function Icon({
  name,
  size = 20,
  filled,
  ...rest
}: { name: IconName; size?: number; filled?: boolean } & SVGProps<SVGSVGElement>) {
  const fill = filled ?? FILLED.includes(name);
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
