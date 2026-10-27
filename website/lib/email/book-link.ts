/**
 * Fresh signed download link for a finished book (tuatale-books/orders/<orderId>/book.pdf).
 * The worker signs a 7-day link at completion; a resend (or a late ship) must not email a
 * link that is about to expire, so the admin re-signs on demand.
 */
import { createServerClient, type TuataleSupabaseClient } from '@/lib/supabase';

export const BOOK_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function signBookPdfUrl(
  orderId: string,
  client: TuataleSupabaseClient = createServerClient(),
): Promise<string> {
  const { data, error } = await client.storage
    .from('tuatale-books')
    .createSignedUrl(`orders/${orderId}/book.pdf`, BOOK_LINK_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(`could not sign book link for order ${orderId}: ${error?.message ?? 'no URL returned'}`);
  }
  return data.signedUrl;
}
