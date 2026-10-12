import type { AgentConversationSnapshot, AgentRecordedEvent, AgentTimelineEntry } from '../contracts/AgentConversationStream';

/** Applies a committed event by stable display identity. Cursor deduplication belongs to the client. */
export function applyAgentUpdate(snapshot: AgentConversationSnapshot, update: AgentRecordedEvent): void {
	const event = update.event;
	if (event.type === 'run.state') {
		snapshot.run = event.run;
		if (['completed', 'failed', 'blocked', 'cancelled'].includes(event.run.status)) {
			for (const item of snapshot.timeline) {
				if (item.kind === 'message' || item.kind === 'reasoning_summary') item.streaming = false;
				if (item.kind === 'tool' && item.state === 'calling') { item.state = 'error'; item.error = { message: 'This tool call ended before a result was recorded.' }; }
			}
		}
		return;
	}
	if (event.type === 'status.changed') { snapshot.activity = event.activity; return; }
	if (event.type === 'item.changed') { upsert(snapshot, event.item); return; }
	if (event.type === 'text.delta' && update.itemId) {
		let item = snapshot.timeline.find(item => item.id === update.itemId);
		if (!item) { item = { kind: 'message', id: update.itemId, role: 'assistant', content: '', citations: [], createdAt: new Date().toISOString(), streaming: true }; snapshot.timeline.push(item); }
		if (item.kind === 'message') { item.content += event.delta; item.streaming = true; }
		return;
	}
	if (event.type === 'reasoning.summary.delta') {
		let item = snapshot.timeline.find(item => item.id === event.id);
		if (!item) { item = { kind: 'reasoning_summary', id: event.id, text: '', createdAt: new Date().toISOString(), streaming: true }; snapshot.timeline.push(item); }
		if (item.kind === 'reasoning_summary') { item.text += event.delta; item.streaming = true; }
		return;
	}
	if (event.type === 'citation.added') {
		const item = snapshot.timeline.find(item => item.id === update.itemId);
		if (item?.kind === 'message' && !item.citations.some(citation => citation.url === event.citation.url)) item.citations.push(event.citation);
	}
	if (event.type === 'tool.progress') {
		const item = snapshot.timeline.find(item => item.id === event.id);
		if (item?.kind === 'tool' && !item.progressUpdates.some(progress => progress.id === event.progress.id)) item.progressUpdates = [...item.progressUpdates, event.progress].slice(-100);
	}
}

/** Merges a canonical item without losing earlier tool progress or downgrading completed tools. */
function upsert(snapshot: AgentConversationSnapshot, item: AgentTimelineEntry): void {
	const index = snapshot.timeline.findIndex(current => current.id === item.id);
	if (index < 0) { snapshot.timeline.push(item); return; }
	const previous = snapshot.timeline[index]!;
	if (item.kind === 'tool' && previous.kind === 'tool') {
		item.progressUpdates = [...previous.progressUpdates, ...item.progressUpdates].filter((entry, position, all) => all.findIndex(other => other.id === entry.id) === position).slice(-100);
		if (item.state === 'calling' && previous.state !== 'calling') { item.state = previous.state; item.result = previous.result; item.error = previous.error; }
	}
	snapshot.timeline[index] = item;
}
