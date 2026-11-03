export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type TableDefinition<Row, Insert, Update = Partial<Insert>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      email_delivery_events: {
        Row: {
          bounce_reason: string | null
          created_at: string
          contact_id: string | null
          email: string
          event_at: string
          id: string
          raw: Json
          resend_id: string | null
          subject: string | null
          type: string
        }
        Insert: {
          bounce_reason?: string | null
          created_at?: string
          contact_id?: string | null
          email: string
          event_at?: string
          id?: string
          raw?: Json
          resend_id?: string | null
          subject?: string | null
          type: string
        }
        Update: {
          bounce_reason?: string | null
          created_at?: string
          contact_id?: string | null
          email?: string
          event_at?: string
          id?: string
          raw?: Json
          resend_id?: string | null
          subject?: string | null
          type?: string
        }
        Relationships: []
      }
      scouted_companies: {
        Row: {
          created_at: string
          domain: string
          employee_count: number | null
          id: string
          industry: string | null
          linkedin_url: string | null
          name: string
          stage: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          created_at?: string
          domain: string
          employee_count?: number | null
          id?: string
          industry?: string | null
          linkedin_url?: string | null
          name: string
          stage?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          created_at?: string
          domain?: string
          employee_count?: number | null
          id?: string
          industry?: string | null
          linkedin_url?: string | null
          name?: string
          stage?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      sourced_contacts: {
        Row: {
          company_id: string
          commercialization_eligible: boolean
          commercialization_reviewed_at: string | null
          created_at: string
          do_not_contact: boolean
          email: string | null
          email_status: string
          first_sourced_at: string
          full_name: string
          id: string
          last_sourced_at: string
          linkedin_url: string | null
          lawful_basis: string | null
          opted_out_at: string | null
          retention_review_at: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          commercialization_eligible?: boolean
          commercialization_reviewed_at?: string | null
          created_at?: string
          do_not_contact?: boolean
          email?: string | null
          email_status?: string
          first_sourced_at?: string
          full_name: string
          id?: string
          last_sourced_at?: string
          linkedin_url?: string | null
          lawful_basis?: string | null
          opted_out_at?: string | null
          retention_review_at?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          commercialization_eligible?: boolean
          commercialization_reviewed_at?: string | null
          created_at?: string
          do_not_contact?: boolean
          email?: string | null
          email_status?: string
          first_sourced_at?: string
          full_name?: string
          id?: string
          last_sourced_at?: string
          linkedin_url?: string | null
          lawful_basis?: string | null
          opted_out_at?: string | null
          retention_review_at?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      contact_sources: {
        Row: {
          contact_id: string
          external_record_id: string | null
          id: string
          metadata: Json
          observed_at: string
          provider: string
          source_url: string | null
        }
        Insert: {
          contact_id: string
          external_record_id?: string | null
          id?: string
          metadata?: Json
          observed_at?: string
          provider: string
          source_url?: string | null
        }
        Update: {
          contact_id?: string
          external_record_id?: string | null
          id?: string
          metadata?: Json
          observed_at?: string
          provider?: string
          source_url?: string | null
        }
        Relationships: []
      }
      scout_automation_settings: TableDefinition<
        {
          id: number
          enabled: boolean
          search_query: string
          daily_cycle_date: string | null
          daily_cycle_count: number
          cycle_lock_token: string | null
          cycle_lock_until: string | null
          last_cycle_at: string | null
          last_error: string | null
          updated_at: string
        },
        {
          id?: number
          enabled?: boolean
          search_query?: string
          daily_cycle_date?: string | null
          daily_cycle_count?: number
          cycle_lock_token?: string | null
          cycle_lock_until?: string | null
          last_cycle_at?: string | null
          last_error?: string | null
          updated_at?: string
        }
      >
      scout_automation_runs: TableDefinition<
        {
          id: string
          cycle_token: string
          status: string
          companies_reviewed: number
          drafts_created: number
          summary: string | null
          error: string | null
          started_at: string
          completed_at: string | null
        },
        {
          id?: string
          cycle_token: string
          status: string
          companies_reviewed?: number
          drafts_created?: number
          summary?: string | null
          error?: string | null
          started_at?: string
          completed_at?: string | null
        }
      >
      scout_automation_outbox: TableDefinition<
        {
          id: string
          source_key: string
          source_type: string
          source_inbound_id: string | null
          parent_sent_id: string | null
          contact_id: string | null
          company_name: string
          recipient_name: string
          recipient_email: string
          subject: string
          body: string
          source_urls: string[]
          status: string
          last_error: string | null
          created_at: string
          updated_at: string
          sent_at: string | null
        },
        {
          id?: string
          source_key: string
          source_type: string
          source_inbound_id?: string | null
          parent_sent_id?: string | null
          contact_id?: string | null
          company_name: string
          recipient_name: string
          recipient_email: string
          subject: string
          body: string
          source_urls?: string[]
          status?: string
          last_error?: string | null
          created_at?: string
          updated_at?: string
          sent_at?: string | null
        }
      >
      scout_automation_sent_emails: TableDefinition<
        {
          id: string
          outbox_id: string | null
          contact_id: string | null
          recipient_email: string
          recipient_name: string
          company_name: string
          subject: string
          body: string
          resend_id: string | null
          source_type: string
          parent_sent_id: string | null
          sent_at: string
        },
        {
          id?: string
          outbox_id?: string | null
          contact_id?: string | null
          recipient_email: string
          recipient_name: string
          company_name: string
          subject: string
          body: string
          resend_id?: string | null
          source_type: string
          parent_sent_id?: string | null
          sent_at?: string
        }
      >
      scout_automation_inbound_emails: TableDefinition<
        {
          id: string
          resend_id: string
          sender_email: string
          recipient_email: string
          subject: string
          body: string
          received_at: string
          status: string
          sent_email_id: string | null
          outbox_id: string | null
        },
        {
          id?: string
          resend_id: string
          sender_email: string
          recipient_email: string
          subject?: string
          body?: string
          received_at?: string
          status?: string
          sent_email_id?: string | null
          outbox_id?: string | null
        }
      >
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_scout_automation_cycle: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      finish_scout_automation_cycle: {
        Args: { p_lock_token: string; p_error?: string | null }
        Returns: boolean
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {}
  }
} as const
