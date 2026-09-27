<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { WebSocketClient, type WebSocketClientState } from '@db3.ai/app/websocket/client';
import type { ChatMessage, Participant, Point, Stroke } from '../server/collaboration/contracts';
import { api } from './api';

const props = defineProps<{ user: { id: string; name: string } | null }>();
const requestedRoom = new URL(location.href).searchParams.get('room');
const room = ref(requestedRoom && ['lobby', 'members', 'studio'].includes(requestedRoom) ? requestedRoom : 'lobby');
const state = ref<WebSocketClientState>('closed');
const loaded = ref(false);
const ownId = ref('');
const name = ref('Guest');
const color = ref('#6366f1');
const strokes = ref<Stroke[]>([]);
const participants = ref<Participant[]>([]);
const messages = ref<ChatMessage[]>([]);
const events = ref<string[]>([]);
const draft = ref<Point[]>([]);
const text = ref('');
const code = ref('');
const error = ref('');
let socket: WebSocketClient | undefined;
let lastCursor = 0;
let pointer: number | null = null;

/** Sends the demo profile; signed-in names remain server-owned. */
function profile() { socket?.send({ type: 'profile', name: name.value.trim() || 'Guest', color: color.value }); }
/** Connects to an explicit endpoint; old room callbacks cannot mutate the new room. */
function connect() {
	socket?.close(); loaded.value = false; participants.value = []; events.value = []; strokes.value = []; messages.value = []; draft.value = []; pointer = null; error.value = '';
	const current = new WebSocketClient({
		url: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/rooms/${room.value}`,
		auth: room.value === 'lobby' ? 'public' : 'cookie',
		onState(value) { if (socket !== current) return; state.value = value; if (value !== 'connected') { loaded.value = false; participants.value = []; draft.value = []; pointer = null; } },
		onMessage(value) {
			if (socket !== current || !value || typeof value !== 'object') return;
			const data = value as any;
			if (data.type === 'history-start') { strokes.value = []; messages.value = data.messages; ownId.value = data.id; loaded.value = false; }
			if (data.type === 'history-end') { loaded.value = true; profile(); }
			if (data.type === 'stroke') strokes.value.push(data.stroke);
			if (data.type === 'chat') messages.value = [...messages.value, data.message].slice(-50);
			if (data.type === 'presence') participants.value = data.participants;
			if (data.type === 'cursor') { const member = participants.value.find(member => member.id === data.id); if (member) member.cursor = data.point; }
			if (data.type === 'joined' || data.type === 'left') events.value = [`${data.name} ${data.type === 'joined' ? 'joined' : 'left'} the room`, ...events.value].slice(0, 8);
			if (data.type === 'error') error.value = data.message;
		},
	});
	socket = current; current.connect();
}
/** Leaves explicitly and stops automatic reconnect. */
function leave() { socket?.close(); }
/** Exchanges a demo invitation for a durable server-side room grant. */
async function joinStudio() {
	try { await api('/rooms/studio/join', { code: code.value }); connect(); }
	catch (cause) { error.value = cause instanceof Error ? cause.message : 'Unable to join.'; }
}
/** Converts pointer coordinates into bounded, viewport-independent board coordinates. */
function position(event: PointerEvent): Point {
	const bounds = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
	return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
}
/** Starts a single captured drawing gesture. */
function start(event: PointerEvent) {
	if (!loaded.value || pointer !== null || event.button !== 0) return;
	pointer = event.pointerId; (event.currentTarget as Element).setPointerCapture(pointer); draft.value = [position(event)];
}
/** Shares throttled cursors and accumulates a bounded local stroke preview. */
function move(event: PointerEvent) {
	if (!loaded.value) return;
	const point = position(event);
	if (Date.now() - lastCursor > 100) { lastCursor = Date.now(); socket?.send({ type: 'cursor', point }); }
	if (pointer === event.pointerId && draft.value.length < 200) draft.value.push(point);
}
/** Submits a complete stroke; the committed server echo becomes the saved drawing. */
function finish(event: PointerEvent) {
	if (pointer !== event.pointerId) return;
	if (draft.value.length === 1) draft.value.push(position(event));
	if (!socket?.send({ type: 'stroke', color: color.value, points: draft.value })) error.value = 'Disconnected: this stroke was not saved.';
	draft.value = []; pointer = null;
}
/** Cancels an interrupted gesture without publishing a partial edit. */
function cancel() { draft.value = []; pointer = null; }
/** Formats normalized points for the shared SVG coordinate system. */
function path(points: Point[]) { return points.map(point => `${point.x * 1000},${point.y * 600}`).join(' '); }
/** Sends chat only while connected; unsent text stays in the input. */
function chat() { if (text.value.trim() && socket?.send({ type: 'chat', text: text.value.trim() })) text.value = ''; }
/** Keeps the selected room shareable and restores the same board after refresh. */
function changeRoom() {
	const url = new URL(location.href); url.searchParams.set('room', room.value);
	history.replaceState(null, '', url); connect();
}
watch(room, changeRoom);
watch(() => props.user?.id, connect);
onMounted(connect);
onUnmounted(() => socket?.close());
</script>

<template>
	<section class="space-y-6" aria-label="Collaboration demo">
		<div><p class="text-sm uppercase tracking-widest text-muted-fg">WebSocket playground</p><h1 class="mt-2 text-3xl font-semibold">A room for ideas.</h1><p class="mt-3 text-muted-fg">Chat, draw and see who is here. Open this page in another tab to collaborate. Refresh to reload saved drawings and recent chat.</p></div>
		<div class="flex flex-wrap items-end gap-4 rounded-xl border border-border p-4">
			<label>Room<select v-model="room" class="form-input mt-1"><option value="lobby">Public lobby</option><option value="members">Signed-in members</option><option value="studio">Gated studio</option></select></label>
			<label v-if="room === 'lobby'">Guest name<input v-model="name" class="form-input mt-1" maxlength="32" @change="profile"></label>
			<label>Drawing color<input v-model="color" type="color" class="mt-1 block h-10 w-16" @change="profile"></label>
			<p role="status" class="py-2 text-sm">{{ state }} · {{ participants.length }} here</p>
			<button class="rounded-lg border border-border px-3 py-2" @click="connect">Reconnect</button><button class="rounded-lg border border-border px-3 py-2" @click="leave">Leave room</button>
		</div>
		<p class="text-sm text-muted-fg">{{ room === 'lobby' ? 'Public endpoint: no account required. Even signed-in visitors join as guests.' : room === 'members' ? 'Authenticated endpoint: the server verifies your session before accepting the connection and each action.' : 'Gated endpoint: a valid session is not enough. The server also checks your room grant.' }}</p>
		<p v-if="room !== 'lobby' && !user" role="alert">Sign in using the navigation above to enter this room.</p>
		<form v-if="room === 'studio' && user && !loaded" class="flex flex-wrap items-end gap-3" @submit.prevent="joinStudio"><label>Room code<input v-model="code" class="form-input mt-1" required maxlength="128"></label><button class="rounded-lg border border-border px-4 py-2">Join studio</button><p class="text-sm text-muted-fg">Local demo default: draw-together. Set DEMO_ROOM_CODE on your server.</p></form>
		<p v-if="error" role="alert" class="text-destructive">{{ error }}</p>
		<div class="grid gap-6 lg:grid-cols-[1fr_280px]">
			<div class="min-w-0"><div class="mb-2 flex justify-between text-sm"><h2 class="font-semibold">Shared whiteboard</h2><span>{{ strokes.length }}/500 saved strokes</span></div>
				<svg aria-label="Shared drawing canvas" role="img" viewBox="0 0 1000 600" preserveAspectRatio="none" class="aspect-[5/3] w-full touch-none rounded-xl border border-border bg-white" :style="{ cursor: loaded ? 'crosshair' : 'not-allowed' }" @pointerdown.prevent="start" @pointermove="move" @pointerup="finish" @pointercancel="cancel" @lostpointercapture="cancel" @pointerleave="socket?.send({ type: 'cursor', point: null })">
					<defs><pattern id="board-grid" width="25" height="25" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#d1d5db" /></pattern></defs><rect width="1000" height="600" fill="url(#board-grid)" />
					<polyline v-for="stroke in strokes" :key="stroke.id" :points="path(stroke.points)" :stroke="stroke.color" fill="none" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
					<polyline :points="path(draft)" :stroke="color" fill="none" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
					<template v-for="member in participants" :key="member.id"><g v-if="member.id !== ownId && member.cursor" :transform="`translate(${member.cursor.x * 1000},${member.cursor.y * 600})`" pointer-events="none"><path d="M0 0 L0 18 L5 13 L11 24 L15 22 L9 11 L17 10 Z" :fill="member.color" stroke="white" /><text x="20" y="25" :fill="member.color" font-size="16">{{ member.name }}</text></g></template>
				</svg><p class="mt-2 text-xs text-muted-fg">Drawings are shared when you release the pointer. Cursors are live. Presence counts tabs, not unique accounts. Public content is visible to everyone in the lobby.</p>
			</div>
			<aside class="space-y-5"><div><h2 class="font-semibold">In this room</h2><ul class="mt-2 space-y-1"><li v-for="member in participants" :key="member.id" class="flex items-center gap-2 text-sm"><span class="h-2 w-2 rounded-full" :style="{ background: member.color }" />{{ member.name }}{{ member.id === ownId ? ' (you)' : '' }}</li></ul><p v-if="!participants.length" class="mt-2 text-sm text-muted-fg">No live presence while disconnected.</p></div><ol aria-label="Room activity" class="space-y-1 text-xs text-muted-fg"><li v-for="(event, index) in events" :key="index">{{ event }}</li></ol>
				<div><h2 class="font-semibold">Room chat</h2><div aria-label="Chat messages" class="my-3 max-h-60 space-y-3 overflow-y-auto"><p v-if="!messages.length" class="text-sm text-muted-fg">Say hello.</p><p v-for="message in messages" :key="message.id" class="break-words text-sm"><strong>{{ message.author }}</strong><br>{{ message.text }}</p></div><form class="space-y-2" @submit.prevent="chat"><label class="sr-only" for="chat-message">Chat message</label><input id="chat-message" v-model="text" class="form-input" placeholder="Say something…" maxlength="500" :disabled="!loaded" required><button class="rounded-lg border border-border px-4 py-2 text-sm" :disabled="!loaded">Send message</button></form></div>
			</aside>
		</div>
	</section>
</template>
