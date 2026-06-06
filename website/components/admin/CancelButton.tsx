'use client';

/**
 * Cancel button that gates the underlying Server Action behind a
 * native window.confirm() dialog. A misclick on Cancel would
 * permanently kill the job — confirmation is the cheapest possible
 * safety net for a single-admin internal tool.
 *
 * Sibling `Ship` and `Retry` buttons don't need this because their
 * destructive impact is reversible (Ship is the success path,
 * Retry restarts the pipeline).
 *
 * The action prop is the bound Server Action from the parent Server
 * Component (`cancelJobAction.bind(null, jobId)`).
 */
import { Button } from '@/components/ui/Button';

interface CancelButtonProps {
  action: (formData: FormData) => void | Promise<void>;
}

export function CancelButton({ action }: CancelButtonProps) {
  return (
    <Button
      type="submit"
      variant="ghost"
      formAction={action}
      onClick={(e) => {
        if (!window.confirm('Cancel this order? This cannot be undone.')) {
          e.preventDefault();
        }
      }}
      className="text-red-700 hover:bg-red-50"
    >
      Cancel
    </Button>
  );
}
