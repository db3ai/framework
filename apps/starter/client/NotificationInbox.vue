<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { DomAlert, DomBadge, DomButton, DomCard, DomToastStack } from '@getdom/studio/vue';
import type { InAppItem, InAppInboxPage, InAppTransition } from '@db3.ai/app/in-app/contracts';
import { api } from './api';
import { notificationTone, notificationToast } from './notificationPresentation';
import { WebSocketClient } from '@db3.ai/app/websocket/client';

const items = ref<InAppItem[]>([]);
const banners = ref<InAppItem[]>([]);
const unread = ref(0);
const next = ref<string | null>(null);
const open = ref(false);
const busy = ref(false);
const error = ref('');
const toasts = ref<ReturnType<typeof notificationToast>[]>([]);
let disposed = false;
let refreshing: Promise<void> | undefined;
let refreshPending = false;
const socket = new WebSocketClient({ url: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/inbox`, auth: 'cookie', onMessage: () => { void refreshLive(); } });

/** Coalesces invalidations while ensuring a change during a fetch causes another fetch. */
async function refreshLive() {
	refreshPending = true;
	if (refreshing) return refreshing;
	refreshing = (async () => {
		try { while (refreshPending && !disposed) { refreshPending = false; await refresh(); } }
		catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : 'Unable to refresh notifications.'; }
		finally { refreshing = undefined; }
	})();
	return refreshing;
}

/** Refreshes durable state without replaying old toast messages as new arrivals. */
async function refresh() {
	const [inbox, bannerPage] = await Promise.all([api<InAppInboxPage>('/inbox'), api<InAppInboxPage>('/inbox?view=banners')]);
	if (disposed) return;
	items.value = inbox.items; next.value = inbox.nextBefore; unread.value = inbox.unreadCount; banners.value = bannerPage.items;
}

/** Serializes user actions and surfaces failures without optimistic state loss. */
async function perform(work: () => Promise<void>) {
	if (busy.value) return;
	busy.value = true; error.value = '';
	try { await work(); } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : 'Unable to load notifications.'; } finally { busy.value = false; }
}

/** Applies independent read, dismissal or archive state, then reloads persisted results. */
async function update(item: InAppItem, transition: InAppTransition) {
	await perform(async () => { await api(`/inbox/${item.id}`, { transition }); await refresh(); });
}

/** Loads the next inbox page; its cursor is a position, not a live delivery cursor. */
async function loadMore() {
	await perform(async () => {
		if (!next.value) return;
		const page = await api<InAppInboxPage>(`/inbox?before=${encodeURIComponent(next.value)}`);
		if (disposed) return;
		const known = new Set(items.value.map(item => item.id));
		items.value.push(...page.items.filter(item => !known.has(item.id))); next.value = page.nextBefore; unread.value = page.unreadCount;
	});
}

/** Creates only the fixed demo message for this session; toast display is limited to this new receipt. */
async function demo(presentation: 'inbox' | 'toast' | 'banner') {
	await perform(async () => {
		const receipt = await api<{ id: string }>('/inbox/demo', { presentation });
		await refresh();
		if (disposed || presentation !== 'toast') return;
		const item = items.value.find(item => item.id === receipt.id);
		if (item) toasts.value.push(notificationToast(item));
	});
}

/** Removes a transient toast without changing the durable inbox item. */
function dismissToast(id: string) { toasts.value = toasts.value.filter(toast => toast.id !== id); }

/** Opens the accessible inbox disclosure and fetches current server state. */
function toggle() { open.value = !open.value; if (open.value) void perform(refresh); }

onMounted(() => { void perform(refresh); socket.connect(); });
onUnmounted(() => { disposed = true; socket.close(); toasts.value = []; });
</script>

<template>
	<section aria-label="Notifications" class="mb-10 space-y-4">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<DomButton variant="secondary" :aria-expanded="open" aria-controls="notification-inbox" @click="toggle">Notifications <DomBadge class="ml-2" aria-live="polite">{{ unread }}</DomBadge><span class="sr-only"> unread</span></DomButton>
			<div class="flex flex-wrap gap-2" aria-label="Notification demo"><DomButton size="sm" variant="secondary" :disabled="busy" @click="demo('inbox')">Send inbox message</DomButton><DomButton size="sm" variant="secondary" :disabled="busy" @click="demo('toast')">Send toast</DomButton><DomButton size="sm" variant="secondary" :disabled="busy" @click="demo('banner')">Send banner</DomButton></div>
		</div>
		<DomAlert v-if="error" tone="danger" title="Unable to update notifications" :description="error"><template #actions><DomButton size="sm" variant="secondary" :disabled="busy" @click="perform(refresh)">Retry</DomButton></template></DomAlert>
		<DomAlert v-for="item in banners" :key="item.id" :tone="notificationTone(item.message.severity)" :title="item.message.title" :description="item.message.body">
			<template #actions><DomButton v-if="item.message.action" as="a" size="sm" variant="secondary" :href="item.message.action.href">{{ item.message.action.label }}</DomButton><DomButton size="sm" variant="ghost" :disabled="busy" @click="update(item, 'dismiss')">Dismiss banner</DomButton></template>
		</DomAlert>
		<DomCard v-if="open" id="notification-inbox" padding="md" @keydown.esc="open = false">
			<div class="flex items-center justify-between"><h2 class="text-lg font-semibold">Your inbox</h2><DomButton size="sm" variant="ghost" :disabled="busy" @click="perform(refresh)">Refresh</DomButton></div>
			<p v-if="busy" role="status" class="mt-3 text-sm text-muted-fg">Updating inbox…</p>
			<p v-else-if="!items.length" class="py-6 text-sm text-muted-fg">You're all caught up. Send a demo message to try it.</p>
			<article v-for="item in items" :key="item.id" class="border-b border-border py-4 last:border-0">
				<h3 :class="item.readAt ? 'font-normal' : 'font-semibold'">{{ item.message.title }} <DomBadge v-if="!item.readAt" class="ml-2">Unread</DomBadge></h3>
				<p class="mt-1 text-sm text-muted-fg">{{ item.message.body }}</p>
				<div class="mt-3 flex flex-wrap gap-4 text-sm"><a v-if="item.message.action" :href="item.message.action.href" class="underline">{{ item.message.action.label }}</a><DomButton size="sm" variant="ghost" :disabled="busy" @click="update(item, item.readAt ? 'unread' : 'read')">{{ item.readAt ? 'Mark unread' : 'Mark read' }}</DomButton><DomButton size="sm" variant="ghost" :disabled="busy" @click="update(item, 'archive')">Archive</DomButton></div>
			</article>
			<DomButton v-if="next" class="mt-4" size="sm" variant="secondary" :disabled="busy" @click="loadMore">Load older messages</DomButton>
		</DomCard>
		<DomToastStack :toasts="toasts" position="bottom-right" @dismiss="dismissToast" />
	</section>
</template>
