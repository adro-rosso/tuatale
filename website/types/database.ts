export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      drafts: {
        Row: {
          age_range: string | null
          character_generation_mode: string
          child_age: number | null
          child_appearance: string | null
          child_gender: string | null
          child_name: string | null
          converted_to_order_id: string | null
          cookie_id: string
          created_at: string
          current_step: string
          customer_email: string | null
          estimated_price_cents: number | null
          expires_at: string
          id: string
          photo_consent_at: string | null
          photo_urls: Json
          secondaries: Json
          status: string
          theme: string | null
          theme_template_id: string | null
          updated_at: string
        }
        Insert: {
          age_range?: string | null
          character_generation_mode?: string
          child_age?: number | null
          child_appearance?: string | null
          child_gender?: string | null
          child_name?: string | null
          converted_to_order_id?: string | null
          cookie_id: string
          created_at?: string
          current_step?: string
          customer_email?: string | null
          estimated_price_cents?: number | null
          expires_at?: string
          id?: string
          photo_consent_at?: string | null
          photo_urls?: Json
          secondaries?: Json
          status?: string
          theme?: string | null
          theme_template_id?: string | null
          updated_at?: string
        }
        Update: {
          age_range?: string | null
          character_generation_mode?: string
          child_age?: number | null
          child_appearance?: string | null
          child_gender?: string | null
          child_name?: string | null
          converted_to_order_id?: string | null
          cookie_id?: string
          created_at?: string
          current_step?: string
          customer_email?: string | null
          estimated_price_cents?: number | null
          expires_at?: string
          id?: string
          photo_consent_at?: string | null
          photo_urls?: Json
          secondaries?: Json
          status?: string
          theme?: string | null
          theme_template_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          age_range: string
          amount_paid_cents: number
          book_pdf_url: string | null
          character_generation_mode: string
          child_age: number
          child_appearance: string
          child_gender: string
          child_name: string
          converted_from_draft_id: string | null
          created_at: string
          currency: string
          customer_email: string
          id: string
          paid_at: string
          photo_consent_at: string | null
          photo_urls: Json
          pipeline_completed_at: string | null
          pipeline_error: Json | null
          pipeline_started_at: string | null
          pipeline_status: string
          secondaries: Json
          story_dir: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string
          theme: string
          theme_template_id: string | null
          updated_at: string
        }
        Insert: {
          age_range: string
          amount_paid_cents: number
          book_pdf_url?: string | null
          character_generation_mode?: string
          child_age: number
          child_appearance: string
          child_gender: string
          child_name: string
          converted_from_draft_id?: string | null
          created_at?: string
          currency?: string
          customer_email: string
          id?: string
          paid_at: string
          photo_consent_at?: string | null
          photo_urls?: Json
          pipeline_completed_at?: string | null
          pipeline_error?: Json | null
          pipeline_started_at?: string | null
          pipeline_status?: string
          secondaries?: Json
          story_dir?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id: string
          theme: string
          theme_template_id?: string | null
          updated_at?: string
        }
        Update: {
          age_range?: string
          amount_paid_cents?: number
          book_pdf_url?: string | null
          character_generation_mode?: string
          child_age?: number
          child_appearance?: string
          child_gender?: string
          child_name?: string
          converted_from_draft_id?: string | null
          created_at?: string
          currency?: string
          customer_email?: string
          id?: string
          paid_at?: string
          photo_consent_at?: string | null
          photo_urls?: Json
          pipeline_completed_at?: string | null
          pipeline_error?: Json | null
          pipeline_started_at?: string | null
          pipeline_status?: string
          secondaries?: Json
          story_dir?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string
          theme?: string
          theme_template_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pipeline_jobs: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          error_details: Json | null
          error_message: string | null
          failed_at: string | null
          generation_metadata: Json | null
          id: string
          inngest_event_id: string | null
          inngest_run_id: string | null
          notification_error: string | null
          notification_message_id: string | null
          notification_sent_at: string | null
          order_id: string
          pdf_url: string | null
          review_notes: string | null
          reviewed_by: string | null
          shipped_at: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          error_details?: Json | null
          error_message?: string | null
          failed_at?: string | null
          generation_metadata?: Json | null
          id?: string
          inngest_event_id?: string | null
          inngest_run_id?: string | null
          notification_error?: string | null
          notification_message_id?: string | null
          notification_sent_at?: string | null
          order_id: string
          pdf_url?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          shipped_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          error_details?: Json | null
          error_message?: string | null
          failed_at?: string | null
          generation_metadata?: Json | null
          id?: string
          inngest_event_id?: string | null
          inngest_run_id?: string | null
          notification_error?: string | null
          notification_message_id?: string | null
          notification_sent_at?: string | null
          order_id?: string
          pdf_url?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          shipped_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_jobs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      preview_events: {
        Row: {
          allowed: boolean
          created_at: string
          customer_email: string | null
          draft_id: string | null
          email_count_24h: number | null
          email_count_lifetime: number | null
          estimated_cost_cents: number | null
          event_type: string
          flagged: boolean
          id: string
          ip_address: unknown
          ip_count_24h: number | null
          suspension_status: string | null
        }
        Insert: {
          allowed: boolean
          created_at?: string
          customer_email?: string | null
          draft_id?: string | null
          email_count_24h?: number | null
          email_count_lifetime?: number | null
          estimated_cost_cents?: number | null
          event_type: string
          flagged?: boolean
          id?: string
          ip_address: unknown
          ip_count_24h?: number | null
          suspension_status?: string | null
        }
        Update: {
          allowed?: boolean
          created_at?: string
          customer_email?: string | null
          draft_id?: string | null
          email_count_24h?: number | null
          email_count_lifetime?: number | null
          estimated_cost_cents?: number | null
          event_type?: string
          flagged?: boolean
          id?: string
          ip_address?: unknown
          ip_count_24h?: number | null
          suspension_status?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
