export type SchedulingWindow = {
  id: string; startDate: string | null; endDate: string | null;
  startTime: string | null; endTime: string | null; blocksCapacity: boolean;
  schedulingState?: string;
};
export type SchedulingAssessment = {
  status: "clear" | "potential_conflict" | "capacity_conflict" | "review_required";
  conflicts: Array<{ id: string; certainty: "definite" | "potential" }>;
  blockingOverlapCount: number; capacity: number; requiresHumanReview: boolean;
};

const inactiveStates = new Set(["cancelled", "declined"]);

function overlapCertainty(a: SchedulingWindow, b: SchedulingWindow): "definite" | "potential" | null {
  if (!a.startDate || !b.startDate) return "potential";
  const aEnd = a.endDate ?? a.startDate;
  const bEnd = b.endDate ?? b.startDate;
  if (a.startDate > bEnd || b.startDate > aEnd) return null;
  const sameSingleDay = aEnd === a.startDate && bEnd === b.startDate && a.startDate === b.startDate;
  if (!sameSingleDay) return "definite";
  if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) return "potential";
  return a.startTime < b.endTime && b.startTime < a.endTime ? "definite" : null;
}

export function assessScheduling(proposed: SchedulingWindow, existing: SchedulingWindow[], capacity: number): SchedulingAssessment {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Capacity must be a positive integer");
  if (!proposed.startDate) return { status: "review_required", conflicts: [], blockingOverlapCount: 0, capacity, requiresHumanReview: true };
  const conflicts = existing
    .filter((event) => event.blocksCapacity && !inactiveStates.has(event.schedulingState ?? ""))
    .map((event) => ({ id: event.id, certainty: overlapCertainty(proposed, event) }))
    .filter((entry): entry is { id: string; certainty: "definite" | "potential" } => entry.certainty !== null);
  const definite = conflicts.filter((conflict) => conflict.certainty === "definite").length;
  if (definite >= capacity) return { status: "capacity_conflict", conflicts, blockingOverlapCount: definite, capacity, requiresHumanReview: true };
  if (conflicts.length >= capacity) return { status: "potential_conflict", conflicts, blockingOverlapCount: definite, capacity, requiresHumanReview: true };
  return { status: "clear", conflicts, blockingOverlapCount: definite, capacity, requiresHumanReview: false };
}
