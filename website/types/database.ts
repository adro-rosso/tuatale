/**
 * Hand-written Supabase Database types — mirror of the schema in
 * supabase/migrations/. Regenerate via `npm run db:types` once the
 * project is linked + migrations are applied to refresh from the live DB
 * (which is also the drift test: if `npm run db:types` produces a diff
 * against this file, the migration and this file are out of sync).
 *
 * Conventions used:
 *   - Postgres uuid           -> string
 *   - timestamptz             -> string (ISO 8601)
 *   - inet                    -> string
 *   - jsonb                   -> Json
 *   - CHECK enums             -> string literal unions
 *   - nullable columns        -> T | null
 *   - Insert: omit columns with defaults (made optional); required only
 *     for not-null no-default columns
 *   - Update: every column optional
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ChildGender = 'boy' | 'girl' | 'non_binary';
export type AgeRange = '3-5' | '5-7' | '7-9';

export type DraftStep = 'child' | 'secondaries' | 'theme' | 'preview' | 'review' | 'payment';
export type DraftStatus = 'active' | 'abandoned' | 'converted' | 'expired';

export type Currency = 'aud' | 'usd';
export type PipelineStatus = 'queued' | 'generating' | 'rendering' | 'complete' | 'failed';

export type PreviewEventType =
  | 'preview_requested'
  | 'preview_generated'
  | 'preview_blocked_threshold'
  | 'admin_flagged'
  | 'admin_suspended'
  | 'admin_cleared';
export type PreviewSuspensionStatus = 'soft_watch' | 'suspended' | 'cleared';

export interface Database {
  public: {
    Tables: {
      drafts: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          expires_at: string;
          cookie_id: string;
          customer_email: string | null;
          child_name: string | null;
          child_age: number | null;
          child_gender: ChildGender | null;
          child_appearance: string | null;
          secondaries: Json;
          theme: string | null;
          theme_template_id: string | null;
          age_range: AgeRange | null;
          current_step: DraftStep;
          estimated_price_cents: number | null;
          status: DraftStatus;
          converted_to_order_id: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          expires_at?: string;
          cookie_id: string;
          customer_email?: string | null;
          child_name?: string | null;
          child_age?: number | null;
          child_gender?: ChildGender | null;
          child_appearance?: string | null;
          secondaries?: Json;
          theme?: string | null;
          theme_template_id?: string | null;
          age_range?: AgeRange | null;
          current_step?: DraftStep;
          estimated_price_cents?: number | null;
          status?: DraftStatus;
          converted_to_order_id?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          expires_at?: string;
          cookie_id?: string;
          customer_email?: string | null;
          child_name?: string | null;
          child_age?: number | null;
          child_gender?: ChildGender | null;
          child_appearance?: string | null;
          secondaries?: Json;
          theme?: string | null;
          theme_template_id?: string | null;
          age_range?: AgeRange | null;
          current_step?: DraftStep;
          estimated_price_cents?: number | null;
          status?: DraftStatus;
          converted_to_order_id?: string | null;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          customer_email: string;
          child_name: string;
          child_age: number;
          child_gender: ChildGender;
          child_appearance: string;
          secondaries: Json;
          theme: string;
          theme_template_id: string | null;
          age_range: AgeRange;
          stripe_session_id: string;
          stripe_payment_intent_id: string | null;
          amount_paid_cents: number;
          currency: Currency;
          paid_at: string;
          pipeline_status: PipelineStatus;
          pipeline_started_at: string | null;
          pipeline_completed_at: string | null;
          pipeline_error: Json | null;
          story_dir: string | null;
          book_pdf_url: string | null;
          converted_from_draft_id: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          customer_email: string;
          child_name: string;
          child_age: number;
          child_gender: ChildGender;
          child_appearance: string;
          secondaries?: Json;
          theme: string;
          theme_template_id?: string | null;
          age_range: AgeRange;
          stripe_session_id: string;
          stripe_payment_intent_id?: string | null;
          amount_paid_cents: number;
          currency?: Currency;
          paid_at: string;
          pipeline_status?: PipelineStatus;
          pipeline_started_at?: string | null;
          pipeline_completed_at?: string | null;
          pipeline_error?: Json | null;
          story_dir?: string | null;
          book_pdf_url?: string | null;
          converted_from_draft_id?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          customer_email?: string;
          child_name?: string;
          child_age?: number;
          child_gender?: ChildGender;
          child_appearance?: string;
          secondaries?: Json;
          theme?: string;
          theme_template_id?: string | null;
          age_range?: AgeRange;
          stripe_session_id?: string;
          stripe_payment_intent_id?: string | null;
          amount_paid_cents?: number;
          currency?: Currency;
          paid_at?: string;
          pipeline_status?: PipelineStatus;
          pipeline_started_at?: string | null;
          pipeline_completed_at?: string | null;
          pipeline_error?: Json | null;
          story_dir?: string | null;
          book_pdf_url?: string | null;
          converted_from_draft_id?: string | null;
        };
        Relationships: [];
      };
      preview_events: {
        Row: {
          id: string;
          created_at: string;
          ip_address: string;
          customer_email: string | null;
          draft_id: string | null;
          event_type: PreviewEventType;
          estimated_cost_cents: number | null;
          ip_count_24h: number | null;
          email_count_24h: number | null;
          email_count_lifetime: number | null;
          allowed: boolean;
          flagged: boolean;
          suspension_status: PreviewSuspensionStatus | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          ip_address: string;
          customer_email?: string | null;
          draft_id?: string | null;
          event_type: PreviewEventType;
          estimated_cost_cents?: number | null;
          ip_count_24h?: number | null;
          email_count_24h?: number | null;
          email_count_lifetime?: number | null;
          allowed: boolean;
          flagged?: boolean;
          suspension_status?: PreviewSuspensionStatus | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          ip_address?: string;
          customer_email?: string | null;
          draft_id?: string | null;
          event_type?: PreviewEventType;
          estimated_cost_cents?: number | null;
          ip_count_24h?: number | null;
          email_count_24h?: number | null;
          email_count_lifetime?: number | null;
          allowed?: boolean;
          flagged?: boolean;
          suspension_status?: PreviewSuspensionStatus | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// Convenience re-exports for callers that don't want to wade through
// Database['public']['Tables']['drafts']['Row'] etc.
export type DraftRow = Database['public']['Tables']['drafts']['Row'];
export type DraftInsert = Database['public']['Tables']['drafts']['Insert'];
export type DraftUpdate = Database['public']['Tables']['drafts']['Update'];

export type OrderRow = Database['public']['Tables']['orders']['Row'];
export type OrderInsert = Database['public']['Tables']['orders']['Insert'];
export type OrderUpdate = Database['public']['Tables']['orders']['Update'];

export type PreviewEventRow = Database['public']['Tables']['preview_events']['Row'];
export type PreviewEventInsert = Database['public']['Tables']['preview_events']['Insert'];
export type PreviewEventUpdate = Database['public']['Tables']['preview_events']['Update'];
