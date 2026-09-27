import type { Logger } from '@db3.ai/app/logging';
import type { OperationalAlerts } from '@db3.ai/app/notifications';

/**
 * Records a terminal job failure using a configured operator outbox and structured logger.
 * Install OperationalAlertRecord through app migrations and run deliverDue() in a separate process.
 * @param alerts - Outbox configured with operator destinations and framework Mail.
 * @param log - Application logger with an operator-controlled persistent destination.
 * @param jobId - Stable job identity, shared by retries of this incident.
 * @param error - Raw failure retained only in local structured diagnostics.
 */
export async function reportOperationalFailure(alerts: OperationalAlerts, log: Logger, jobId: string, error: Error): Promise<void> {
	const key = `job-failed:${jobId}`;
	log.error({ incidentKey: key, jobId, err: error }, 'Background job failed');
	await alerts.record({ key, summary: 'A background job failed permanently', context: { jobId } });
}
