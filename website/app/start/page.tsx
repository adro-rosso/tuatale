import { redirect } from 'next/navigation';

/**
 * /start — entry point for the wizard. By the time this renders, the
 * proxy has already minted (if needed) the draft cookie. We redirect
 * to the first step page; no UI to show here.
 */
export default function StartPage(): never {
  redirect('/start/child');
}
