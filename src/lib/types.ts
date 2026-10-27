/**
 * Row types mirroring the SQL schema (supabase/migrations). Kept by hand for
 * now; regenerate with `supabase gen types` once the CLI is linked.
 */
import type { SlotKey } from "@/domain/config";
import type { DeclaredStatus } from "@/domain/availability";
import type { LifecycleStatus, NecessityLevel, RequestType, ResponseStatus } from "@/domain/status";

export type MemberRole = "admin" | "member";
export type AssignmentStatus = "confirmed" | "pending_reconfirmation" | "cancelled";
export type NotificationType =
  | "new_request"
  | "new_volunteer"
  | "assignment_confirmed"
  | "assignment_cancelled"
  | "reconfirmation_needed"
  | "request_updated"
  | "request_cancelled"
  | "response_reset"
  | "member_joined"
  | "content_reported";

export type ProfileRow = {
  id: string;
  display_name: string;
  avatar_path: string | null;
  timezone: string;
  onboarded_at: string | null;
};

export type GroupRow = { id: string; name: string; created_by: string | null; created_at: string };

export type GroupMemberRow = {
  group_id: string;
  user_id: string;
  role: MemberRole;
  share_availability: boolean;
  joined_at: string;
};

export type InvitationRow = {
  id: string;
  group_id: string;
  created_by: string | null;
  expires_at: string;
  revoked_at: string | null;
  max_uses: number;
  use_count: number;
  created_at: string;
};

export type DogRow = {
  id: string;
  name: string;
  breed: string | null;
  birth_date: string | null;
  photo_path: string | null;
  care_notes: string | null;
  sex: "female" | "male" | null;
  sterilized: boolean | null;
  weight_kg: number | string | null;
  identification: string | null;
  distinctive_marks: string | null;
  meals: string | null;
  walks: string | null;
  sleep: string | null;
  behavior: string | null;
  created_by: string | null;
  archived_at: string | null;
};

export type DogShareLinkRow = {
  id: string;
  include_health: boolean;
  include_emergency: boolean;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
};

export type DogCaretakerRow = { dog_id: string; user_id: string; role: "owner" | "caretaker" };
export type GroupDogRow = { group_id: string; dog_id: string };

export type AvailabilityEntryRow = { user_id: string; date: string; slot: SlotKey; status: DeclaredStatus };
export type AvailabilityRuleRow = {
  id: string;
  user_id: string;
  weekday: number;
  slot: SlotKey;
  status: DeclaredStatus;
};

export type CareRequestRow = {
  id: string;
  group_id: string;
  dog_id: string;
  created_by: string | null;
  request_type: RequestType;
  necessity: NecessityLevel;
  starts_at: string;
  ends_at: string;
  description: string | null;
  splittable: boolean;
  lifecycle_status: LifecycleStatus;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type RequestResponseRow = {
  id: string;
  request_id: string;
  user_id: string;
  response_status: ResponseStatus;
  proposed_starts_at: string | null;
  proposed_ends_at: string | null;
  note: string | null;
  responded_at: string;
};

export type CareAssignmentRow = {
  id: string;
  request_id: string;
  assigned_user_id: string;
  starts_at: string;
  ends_at: string;
  status: AssignmentStatus;
  confirmed_by: string | null;
  confirmed_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  previous_starts_at: string | null;
  previous_ends_at: string | null;
};

export type NotificationRow = {
  id: string;
  group_id: string | null;
  notification_type: NotificationType;
  title: string;
  body: string | null;
  request_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationPreferencesRow = {
  new_requests_enabled: boolean;
  responses_enabled: boolean;
  confirmations_enabled: boolean;
  cancellations_enabled: boolean;
  reminders_enabled: boolean;
  summary_enabled: boolean;
};

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
