import { FileStatus } from '@ethesis/shared';

/**
 * Pseudo "workflow step" filters for the PhD inbox: files where a reminder is due
 * to the National (Indian) examiner, International (Foreign) examiner or Chief Guide.
 * They only filter — the workflow itself is unchanged.
 */
export const REMINDER_FILTERS = [
  { stageCode: 'remind_national', stageName: 'Reminder — National examiner (evaluation pending)' },
  { stageCode: 'remind_international', stageName: 'Reminder — International examiner (evaluation pending)' },
  { stageCode: 'remind_cg', stageName: 'Reminder — Chief Guide (evaluation pending)' },
] as const;

const BUCKET: Record<string, string> = { remind_national: 'INDIAN', remind_international: 'FOREIGN' };
const OPEN = [FileStatus.IN_PROGRESS, FileStatus.ON_HOLD];

export function isReminderFilter(stage?: string) {
  return REMINDER_FILTERS.some((r) => r.stageCode === stage);
}

/** Mongo clause for a step filter: a real stage code, or one of the reminder filters. */
export function stageClause(stage: string): Record<string, unknown> {
  if (stage === 'remind_cg') return { currentStageCode: 'cg_evaluate', status: { $in: OPEN } };
  const bucket = BUCKET[stage];
  if (!bucket) return { currentStageCode: stage };
  return {
    status: { $in: OPEN },
    panel: {
      $elemMatch: {
        bucketCode: bucket,
        consentStatus: 'ACCEPTED',
        isChiefGuide: { $ne: true },
        isPractical: { $ne: true },
        thesisSentAt: { $exists: true, $ne: null },
        'evaluation.submittedAt': { $exists: false },
      },
    },
  };
}

/** Same rule as stageClause, for rows already loaded (workflow-board counts). */
export function matchesReminder(
  stage: string,
  row: { status?: string; currentStageCode?: string; panel?: any[] },
) {
  if (!OPEN.includes(row.status as any)) return false;
  if (stage === 'remind_cg') return row.currentStageCode === 'cg_evaluate';
  const bucket = BUCKET[stage];
  return (row.panel || []).some(
    (p) =>
      p.bucketCode === bucket &&
      p.consentStatus === 'ACCEPTED' &&
      !p.isChiefGuide &&
      !p.isPractical &&
      p.thesisSentAt &&
      !p.evaluation?.submittedAt,
  );
}
