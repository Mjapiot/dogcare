/**
 * What a person of a dog's circle sees of a request they are asked on: the
 * period, whether it is already covered (slots without names), and whether
 * it waits for their answer. Pure and deterministic.
 */
import { computeCoverage, type CoverageResult } from "./coverage";
import { toInterval, type Interval } from "./intervals";
import type { StatusTone } from "./status";
import type { InvitedRequestRow } from "@/lib/types";

export type InvitedView = {
  request: InvitedRequestRow;
  period: Interval;
  coverage: CoverageResult;
  isPast: boolean;
  cancelled: boolean;
  /** No answer yet, and the request still needs someone. */
  needsMyAnswer: boolean;
  /** Short status for lists (always shown with its icon and label). */
  label: string;
  tone: StatusTone;
};

export function buildInvitedView(request: InvitedRequestRow, now: number): InvitedView {
  const period = toInterval(request.starts_at, request.ends_at);
  const coverage = computeCoverage(
    period,
    request.confirmed_slots.map((s) => toInterval(s.starts_at, s.ends_at)),
  );
  const cancelled = request.lifecycle_status === "cancelled";
  const isPast = period.end <= now;
  const mine = request.my_assignments.length > 0;
  const needsMyAnswer =
    !cancelled && !isPast && request.necessity !== "info" && !request.my_response && !mine && coverage.state !== "full";

  const label = cancelled
    ? "Annulée"
    : mine
      ? request.my_assignments.some((a) => a.status === "pending_reconfirmation")
        ? "À reconfirmer"
        : "Garde confirmée"
      : request.necessity === "info"
        ? "Information"
        : coverage.state === "full"
          ? "Déjà couverte"
          : request.my_response?.response_status === "yes"
            ? "Vous avez proposé votre aide"
            : request.my_response?.response_status === "no"
              ? "Vous ne pouvez pas"
              : "Attend votre réponse";

  const tone: StatusTone =
    cancelled || (!mine && request.my_response?.response_status === "no")
      ? "muted"
      : mine || coverage.state === "full"
        ? "covered"
        : request.necessity === "info"
          ? "info"
          : "pending";

  return { request, period, coverage, isPast, cancelled, needsMyAnswer, label, tone };
}
