/**
 * The few glyphs the editor draws itself: one stroke weight, `currentColor`, so a state (muted, active, disabled)
 * is a colour change on the button and never a second image. Decorative: the button carries the name.
 */
interface IconProps {
  readonly size?: number;
}

function Svg({ size = 16, children }: IconProps & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function EyeIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
    </Svg>
  );
}

export function EyeOffIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M2.5 2.5l11 11" />
      <path d="M6.3 4a6.7 6.7 0 0 1 1.7-.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-2 2.5M4.1 5.6A11 11 0 0 0 1.5 8s2.4 4.5 6.5 4.5c.9 0 1.7-.2 2.4-.5" />
      <path d="M6.6 6.7a2 2 0 0 0 2.7 2.7" />
    </Svg>
  );
}

export function LockIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" />
    </Svg>
  );
}

export function UnlockIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.2 7V5a2.8 2.8 0 0 1 5.4-1" />
    </Svg>
  );
}

/** Corner brackets round a dot: "look at this one on its own". */
export function IsolateIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" />
      <circle cx="8" cy="8" r="1.8" fill="currentColor" />
    </Svg>
  );
}

export function PencilIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M2.5 13.5l.7-3L10.8 3a1.4 1.4 0 0 1 2 0l.2.2a1.4 1.4 0 0 1 0 2L5.5 12.8l-3 .7Z" />
      <path d="M9.5 4.3l2.2 2.2" />
    </Svg>
  );
}

/** A flag on a pole: "the game starts here". */
export function FlagIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M3.5 14V2" />
      <path d="M3.5 3h8l-1.8 2.6L11.5 8h-8" />
    </Svg>
  );
}
