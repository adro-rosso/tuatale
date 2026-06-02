/**
 * Tuatale wordmark. Always lowercase, always EB Garamond italic 400,
 * always iron-oxide, always letter-spacing 0.02em.
 *
 * The wordmark IS the brand mark — don't tweak its styling per page.
 * Three sizes: sm (24px), md (40px), lg (64px). Default md.
 */
type WordmarkSize = 'sm' | 'md' | 'lg';

const sizeClasses: Record<WordmarkSize, string> = {
  sm: 'text-[24px]',
  md: 'text-[40px]',
  lg: 'text-[64px]',
};

interface WordmarkProps {
  size?: WordmarkSize;
  className?: string;
}

export function Wordmark({ size = 'md', className = '' }: WordmarkProps) {
  return (
    <span
      className={`font-heading text-iron-oxide tracking-wordmark leading-heading lowercase italic ${sizeClasses[size]} ${className}`}
    >
      tuatale
    </span>
  );
}
