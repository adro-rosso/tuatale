/**
 * Small line-icon set for the wizard — tasteful replacements for the emoji
 * stand-ins (the child "🧒" + pet "🐾") on the hero step. Stroke icons that
 * inherit `currentColor`, so they take the surrounding text colour.
 *
 * Add glyphs sparingly; this isn't a general icon library.
 */
type IconName = 'child' | 'pet' | 'adult';

interface IconProps {
  name: IconName;
  /** Pixel size (width = height). Default 40. */
  size?: number;
  className?: string;
}

export function Icon({ name, size = 40, className = '' }: IconProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {name === 'child' ? (
        <>
          {/* head + shoulders */}
          <circle cx="24" cy="15" r="8" />
          <path d="M9 41c0-8.3 6.7-15 15-15s15 6.7 15 15" />
        </>
      ) : name === 'adult' ? (
        <>
          {/* two grown figures side by side — an adult gift book is often about a pair */}
          <circle cx="17" cy="14" r="6" />
          <path d="M7 40c0-6.6 4.5-12 10-12s10 5.4 10 12" />
          <circle cx="33" cy="17" r="5.5" />
          <path d="M27 40c0-6 3.8-11 8.5-11S43 33.4 43 39" />
        </>
      ) : (
        <>
          {/* cat: ears → head, dot eyes, nose + whiskers */}
          <path d="M14 18 16 8l7 6M34 18 32 8l-7 6" />
          <circle cx="24" cy="27" r="12" />
          <path d="M19.5 25h.01M28.5 25h.01" />
          <path d="M24 30v1.5M24 31.5c-1.4 1.4-3.8 1.4-5 0M24 31.5c1.4 1.4 3.8 1.4 5 0" />
          <path d="M11 27h4M33 27h4" />
        </>
      )}
    </svg>
  );
}
