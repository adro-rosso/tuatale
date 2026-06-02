/**
 * Container primitive — responsive max-width wrapper.
 *
 *   mobile (default): full width, 24px horizontal padding
 *   tablet (768px+):  720px max-width, centered
 *   desktop (1024px+): 960px max-width, centered
 *   wide (1280px+):   1120px max-width, centered
 */
import type { HTMLAttributes } from 'react';

export function Container({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`px-lg tablet:max-w-[720px] desktop:max-w-[960px] wide:max-w-[1120px] mx-auto w-full ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
