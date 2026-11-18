import type { ReactNode } from "react";

/**
 * The shell's iconography.
 *
 * Every mark is drawn (never a character): a character took whatever font
 * resolved it and its ink ran larger than the icons beside it. One 24-unit
 * grid, a 2-unit stroke, round caps — the motif the reference design uses.
 * Each entry is a list of path strings, so a circle and a polyline are the same
 * kind of data and the renderer stays one line.
 */
export const iconPaths = {
  activity: ["M22 12h-4l-3 9L9 3l-3 9H2"],
  archive: ["M3 5h18v4H3z", "M5 9v11h14V9", "M10 13h4"],
  at: ["M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6"],
  background: ["M22 12h-4l-3 9L9 3l-3 9H2"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.7 21a2 2 0 0 1-3.4 0"],
  bot: ["M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z", "M12 8V6", "M9 13h.01", "M15 13h.01", "M9 17h6"],
  check: ["m20 6-11 11-5-5"],
  chevronDown: ["m6 9 6 6 6-6"],
  chevronLeft: ["m15 18-6-6 6-6"],
  chevronRight: ["m9 18 6-6-6-6"],
  chevronUp: ["m18 15-6-6-6 6"],
  circleDot: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", "M12 7v5l3 2"],
  close: ["M18 6 6 18", "M6 6l12 12"],
  command: ["M15 6a3 3 0 1 1 3 3h-3Z", "M9 6a3 3 0 1 0-3 3h3Z", "M15 18a3 3 0 1 0 3-3h-3Z", "M9 18a3 3 0 1 1-3-3h3Z", "M12 6v12", "M6 9h12"],
  copy: ["M9 9h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z", "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"],
  cpu: ["M5 5h14v14H5z", "M9 2v3", "M15 2v3", "M9 19v3", "M15 19v3", "M2 9h3", "M2 15h3", "M19 9h3", "M19 15h3", "M9 9h6v6H9z"],
  download: ["M12 4v11", "m7 10 5 5 5-5", "M4 19h16"],
  edit: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"],
  file: ["M15 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z", "M14 3v4h5"],
  fileCode: ["M15 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z", "M14 3v4h5", "m10 12-2 2 2 2", "m14 12 2 2-2 2"],
  fileText: ["M15 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z", "M14 3v4h5", "M9 12h6", "M9 16h6"],
  folder: ["M20 20a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7.6a2 2 0 0 1-1.7-.9L9.6 4.6A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"],
  folderOpen: ["M6 20a2 2 0 0 1-2-1l-2-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1l-2 6a2 2 0 0 1-2 1Z", "M4 12V5a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.7.9l.9 1.2a2 2 0 0 0 1.7.9H20a2 2 0 0 1 2 2v3"],
  gear: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6", "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 7 2.6h.1A1.7 1.7 0 0 0 9 1.1V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.2 1.3Z"],
  gitBranch: ["M6 3v15", "M18 9a9 9 0 0 1-9 9", "M18 6a3 3 0 1 0 0-.1", "M6 21a3 3 0 1 0 0-.1"],
  goals: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10", "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2"],
  grid: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
  info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", "M12 11v5", "M12 8h.01"],
  keyboard: ["M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z", "M7 10h.01", "M11 10h.01", "M15 10h.01", "M7 14h10"],
  layers: ["m12 2 9 5-9 5-9-5Z", "m3 12 9 5 9-5", "m3 17 9 5 9-5"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  message: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"],
  moon: ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"],
  more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  panelLeft: ["M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z", "M10 4v16"],
  panelRight: ["M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z", "M14 4v16"],
  paperclip: ["M21.4 11 12.2 20.2a6 6 0 0 1-8.5-8.5l9.2-9.1a4 4 0 0 1 5.6 5.6l-9.1 9.2a2 2 0 0 1-2.9-2.9l8.5-8.4"],
  pin: ["M12 17v5", "M9 3h6l1 7 2 3H6l2-3Z"],
  play: ["m6 3 15 9-15 9Z"],
  plus: ["M12 5v14", "M5 12h14"],
  queue: ["m16 16 4-4-4-4", "M20 12H9a5 5 0 0 1-5-5"],
  refresh: ["M21 12a9 9 0 1 1-2.9-6.6", "M21 3v6h-6"],
  rescue: ["M12 3 2 21h20Z", "M12 10v4", "M12 17h.01"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14", "m20 20-3.9-3.9"],
  send: ["m22 2-7 20-4-9-9-4Z", "M22 2 11 13"],
  sliders: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6"],
  sparkles: ["m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z", "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"],
  square: ["M6 5h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"],
  sun: ["M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10", "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4", "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4"],
  terminal: ["m4 17 6-6-6-6", "M12 19h8"],
  trash: ["M3 6h18", "M8 6V4h8v2", "m6 6 1 15h10l1-15"],
  upload: ["M12 16V4", "m7 9 5-5 5 5", "M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"],
  wifi: ["M5 13a10 10 0 0 1 14 0", "M8.5 16.5a5 5 0 0 1 7 0", "M2 9.6a15 15 0 0 1 20 0", "M12 20h.01"],
  zap: ["M13 2 3 14h8l-1 8 11-13h-9z"],
} as const;

export type IconName = keyof typeof iconPaths;


export interface IconProps {
  name: IconName;
  className?: string;
  size?: "small" | "base" | "large";
  label?: string;
}

export function Icon({ name, className, size = "base", label }: IconProps): ReactNode {
  const paths = iconPaths[name];
  const dimensions = size === "small" ? 12 : size === "large" ? 20 : 16;
  return (
    <svg
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      className={className === undefined ? "piw-icon" : `piw-icon ${className}`}
      fill="none"
      focusable={false}
      height={dimensions}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={dimensions}
    >
      {paths.map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  );
}

export interface IconTriggerProps {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  testId?: string;
}

export function IconButton(props: IconTriggerProps): ReactNode {
  const { icon, label, onClick, active, disabled, className, testId } = props;
  const classes = ["piw-icon-button"];
  if (active === true) classes.push("piw-icon-button--active");
  if (className !== undefined) classes.push(className);
  return (
    <button
      aria-label={label}
      aria-pressed={active === true}
      className={classes.join(" ")}
      data-testid={testId}
      disabled={disabled === true}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon name={icon} />
    </button>
  );
}
