import type * as stream from '../contracts/AgentConversationStream';

/** Applies transient events and canonical saved items by their stable display identity. */
export function applyAgentUpdate(snapshot: stream.AgentConversationSnapshot, update: stream.AgentLiveUpdate): void {
	const event = update.event;
	if (event.type === 'run.state') { snapshot.run = event.run; snapshot.queued = event.queued; return; }
	if (event.type === 'status.changed') { snapshot.activity = event.activity; return; }
	if (event.type === 'item.changed') { upsert(snapshot, event.item); return; }
	if (event.type === 'message.created' || event.type === 'message.completed') {
		upsert(snapshot, { kind: 'message', id: event.id, role: event.role, content: event.content, citations: event.type === 'message.completed' ? event.citations : [], createdAt: event.createdAt, streaming: false }); return;
	}
	if (event.type === 'prompt.context') { const { type: _type, ...item } = event; upsert(snapshot, { kind: 'prompt_context', ...item }); return; }
	if (event.type === 'reasoning.summary.completed') { upsert(snapshot, { kind: 'reasoning_summary', id: event.id, text: event.text, createdAt: event.createdAt, streaming: false }); return; }
	if (event.type === 'text.delta' && update.itemId) {
		let item = snapshot.timeline.find(item => item.id === update.itemId);
		if (!item) { item = { kind: 'message', id: update.itemId, role: 'assistant', content: '', citations: [], createdAt: new Date().toISOString(), streaming: true }; snapshot.timeline.push(item); }
		if (item.kind === 'message' && item.streaming === true) item.content += event.delta;
		return;
	}
	if (event.type === 'reasoning.summary.delta') {
		const id = update.itemId ?? event.id;
		let item = snapshot.timeline.find(item => item.id === id);
		if (!item) { item = { kind: 'reasoning_summary', id, text: '', createdAt: new Date().toISOString(), streaming: true }; snapshot.timeline.push(item); }
		if (item.kind === 'reasoning_summary' && item.streaming === true) item.text += event.delta;
		return;
	}
	if (event.type === 'citation.added') {
		const item = snapshot.timeline.find(item => item.id === update.itemId);
		if (item?.kind === 'message' && !item.citations.some(citation => citation.url === event.citation.url)) item.citations.push(event.citation);
		return;
	}
	if (event.type === 'tool.calling' || event.type === 'tool.success' || event.type === 'tool.error') {
		const previous = snapshot.timeline.find(item => item.id === event.id);
		upsert(snapshot, {
			kind: 'tool', id: event.id, toolName: event.toolName, arguments: event.arguments ?? (previous?.kind === 'tool' ? previous.arguments : null),
			state: event.type === 'tool.calling' ? 'calling' : event.type === 'tool.success' ? 'success' : 'error',
			definition: event.type === 'tool.calling' ? event.toolDefinition : previous?.kind === 'tool' ? previous.definition : null,
			progressUpdates: [], result: event.type === 'tool.success' ? event.result : null, error: event.type === 'tool.error' ? event.error : null,
		});
		return;
	}
	if (event.type === 'tool.progress') {
		const item = snapshot.timeline.find(item => item.id === event.id);
		if (item?.kind === 'tool' && !item.progressUpdates.some(progress => progress.id === event.progress.id)) item.progressUpdates = [...item.progressUpdates, event.progress].slice(-100);
	}
}

/** Replaces partial content while retaining tool progress and preventing delayed calling-state regressions. */
function upsert(snapshot: stream.AgentConversationSnapshot, item: stream.AgentTimelineEntry): void {
	const index = snapshot.timeline.findIndex(current => current.id === item.id);
	if (index < 0) { snapshot.timeline.push(item); return; }
	const previous = snapshot.timeline[index]!;
	if (item.kind === 'tool' && previous.kind === 'tool') {
		item.progressUpdates = [...previous.progressUpdates, ...item.progressUpdates].filter((entry, position, all) => all.findIndex(other => other.id === entry.id) === position).slice(-100);
		if (item.state === 'calling' && previous.state !== 'calling') { item.state = previous.state; item.result = previous.result; item.error = previous.error; }
	}
	snapshot.timeline[index] = item;
}
