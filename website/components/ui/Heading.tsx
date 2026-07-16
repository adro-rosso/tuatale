/**
 * Heading primitive — wraps h1/h2/h3 in Fraunces styling.
 *
 * Level prop controls the semantic tag AND the font-size token (h1/h2/h3).
 * Headings are UPRIGHT by default; italic is OPT-IN via the italic prop and
 * should stay a sparing accent (the wordmark + the odd literary word), never
 * every heading. For the fluid display/title sizes, apply `text-display` /
 * `text-title` via className.
 */
import type { HTMLAttributes } from 'react';

type HeadingLevel = '1' | '2' | '3';

const sizeClasses: Record<HeadingLevel, string> = {
  '1': 'text-h1',
  '2': 'text-h2',
  '3': 'text-h3',
};

interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  level: HeadingLevel;
  italic?: boolean;
}

export function Heading({
  level,
  italic = false,
  className = '',
  children,
  ...rest
}: HeadingProps) {
  // Narrow Tag to the three specific heading tags so React's typed JSX
  // resolves to HTMLHeadingElement (not the catch-all SVGSymbolElement
  // that `keyof JSX.IntrinsicElements` would allow).
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3';
  const classes = `font-heading text-near-black leading-heading ${italic ? 'italic' : 'not-italic'} ${sizeClasses[level]} ${className}`;
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
