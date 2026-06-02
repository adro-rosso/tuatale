/**
 * Body paragraph primitive — Inter 400, near-black, body line-height.
 *
 * Size prop: 'body' (16px) or 'caption' (14px, warm-grey for secondary
 * text like field hints, footnotes, image captions).
 */
import type { HTMLAttributes } from 'react';

type BodySize = 'body' | 'caption';

const sizeClasses: Record<BodySize, string> = {
  body: 'text-body text-near-black',
  caption: 'text-caption text-warm-grey',
};

interface BodyProps extends HTMLAttributes<HTMLParagraphElement> {
  size?: BodySize;
}

export function Body({ size = 'body', className = '', children, ...rest }: BodyProps) {
  return (
    <p className={`font-body leading-body ${sizeClasses[size]} ${className}`} {...rest}>
      {children}
    </p>
  );
}
