import { app } from '@db3.ai/app/server';
import type { InAppAcceptance, InAppMessage } from '@db3.ai/app/in-app';

/** Sends a code-owned message without notification classes, providers or a template database. */
export async function sendReportReady(userId: string, reportId: string): Promise<InAppAcceptance[]> {
	const message: InAppMessage = {
		title: 'Your report is ready',
		body: 'Open the report to review your results.',
		presentation: 'banner',
		severity: 'success',
		action: { label: 'View report', href: `/reports/${encodeURIComponent(reportId)}` },
	};
	return app().inApp.send(userId, message, { scope: { type: 'account' }, type: 'report.ready', key: reportId });
}
