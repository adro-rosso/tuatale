/**
 * Text input primitive — paper fill, hairline border, rounded-xl, with a
 * calm iron-oxide focus ring. Matches the Button's shape language so forms
 * read as one system. Forwards a ref and all native input props.
 */
import { forwardRef, type InputHTMLAttributes } from 'react';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`font-body text-body text-near-black bg-paper border-warm-grey-light placeholder:text-warm-grey/60 focus:border-iron-oxide focus:ring-iron-oxide/20 px-md py-md w-full rounded-xl border transition-colors focus:ring-2 focus:outline-none ${className}`}
        {...rest}
      />
    );
  },
);
