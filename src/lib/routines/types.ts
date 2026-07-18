export type RoutineTriggerType =
  | "conversation_window"
  | "fixed_time"
  | "calendar_event_finished"
  | "location_detected";

export type RoutineRecurrence = "daily" | "weekly" | "once";
export type RoutineConfirmationMode = "automatic" | "ask_first";
export type RoutineActionType =
  | "news_briefing"
  | "custom_briefing"
  | "agenda_briefing"
  | "task_briefing";

export type NewsSource = {
  type: "domain" | "rss" | "official_api";
  value: string;
  label?: string;
};

export type RoutineConfiguration = {
  prompt?: string;
  topics?: string[];
  categories?: string[];
  sources?: NewsSource[];
  sourcesOnly?: boolean;
  preferredSources?: boolean;
  maxItems?: number;
  maxDurationSeconds?: number;
  delivery?: "voice" | "text" | "both";
  askAgainAfterMinutes?: number;
};

export type AssistantRoutine = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  active: boolean;
  trigger_type: RoutineTriggerType;
  recurrence_type: RoutineRecurrence;
  timezone: string;
  start_time: string | null;
  end_time: string | null;
  starts_on: string | null;
  ends_on: string | null;
  days_of_week: number[];
  max_executions_per_period: number;
  confirmation_mode: RoutineConfirmationMode;
  action_type: RoutineActionType;
  configuration: RoutineConfiguration;
  adapt_from_memories: boolean;
  suggest_adjustments: boolean;
  feedback_interval: number;
  execution_count: number;
  last_feedback_at: string | null;
  created_via: "conversation" | "voice" | "page" | "system";
  created_at: string;
  updated_at: string;
};

export type RoutineOpportunity = {
  routine: AssistantRoutine;
  referenceKey: string;
  expiresAt: string | null;
  requiresConfirmation: boolean;
  shouldAskFeedback?: boolean;
};
