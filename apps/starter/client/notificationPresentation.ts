import type { InAppItem, InAppMessage } from '@db3.ai/app/in-app/contracts';

/** Maps framework severity to DOM Studio's visual tone vocabulary. */
export function notificationTone(severity: InAppMessage['severity']) {
	return severity === 'error' ? 'danger' : severity ?? 'info';
}

/** Builds transient DOM Studio content; dismissal never changes stored recipient state. */
export function notificationToast(item: InAppItem) {
	return { id: item.id, title: item.message.title, description: item.message.body, tone: notificationTone(item.message.severity), duration: 6000 };
}
