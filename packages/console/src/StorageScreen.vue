<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { DomMediaBrowser } from '@getdom/studio/vue';
import type { ConsoleDisk, ConsoleStorageListing } from '@db3.ai/app/console';
import { filePath, joinPath, MAX_FILE_BYTES, newFolderName, parentPath, storageItems, type StorageItem } from './storageView';
import type { ConsoleSource } from './source';

/**
 * An app's storage the way Finder shows it: its disks first, then the files inside one disk in
 * getdom.studio's media browser. Each disk is the first path segment, such as `/local/reports`.
 * Uploads, folders, renames, moves and deletes go through the app's own storage disks.
 */
const props = defineProps<{ source: ConsoleSource; readOnly?: string | null }>();

const disks = ref<ConsoleDisk[] | null>(null);
const path = ref('/');
const listing = ref<ConsoleStorageListing | null>(null);
const loading = ref(false);
const error = ref('');
const selected = ref<string[]>([]);
const mode = ref<'grid' | 'list'>('grid');
const progress = ref<number | null>(null);
const confirming = ref(false);

/** Splits `/disk/inner/path` into the disk name and the path inside it. */
function split(value: string) {
	const [disk = '', ...rest] = value.split('/').filter(Boolean);
	return { disk, inner: `/${rest.join('/')}` };
}

const atRoot = computed(() => path.value === '/');
/** Files can be changed: inside a disk, where the host allows it. */
const changeable = computed(() => !atRoot.value && !props.readOnly);
const disk = computed(() => disks.value?.find(item => item.name === split(path.value).disk) ?? null);
const inner = computed(() => split(path.value).inner);
const items = computed<StorageItem[]>(() => {
	if (atRoot.value) return (disks.value ?? []).map(item => ({ ulid: `/${item.name}`, type: 'dir', path: `/${item.name}`, name: item.name, file: null }));
	if (!listing.value || !disk.value) return [];
	const prefix = `/${disk.value.name}`;
	return storageItems(listing.value, props.source.url).map(item => ({ ...item, ulid: `${prefix}${item.path}`, path: `${prefix}${item.path}` }));
});
const breadcrumbs = computed(() => {
	const trail = [{ label: 'Disks', path: '/' }];
	if (!disk.value) return trail;
	let at = `/${disk.value.name}`;
	trail.push({ label: disk.value.name, path: at });
	for (const part of inner.value.split('/').filter(Boolean)) { at = `${at}/${part}`; trail.push({ label: part, path: at }); }
	return trail;
});
const chosen = computed(() => items.value.filter(item => selected.value.includes(item.ulid)));
const chosenFiles = computed(() => chosen.value.filter(item => item.type === 'file'));
const diskOf = (item: StorageItem) => disks.value?.find(entry => `/${entry.name}` === item.path) ?? null;
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;

/** Reads the disks, then the open folder. */
async function load() {
	loading.value = true;
	try {
		disks.value ??= (await props.source.get<{ disks: ConsoleDisk[] }>('storage/disks')).disks;
		if (atRoot.value || !disk.value) { listing.value = null; return; }
		listing.value = await props.source.get<ConsoleStorageListing>(`storage?disk=${encodeURIComponent(disk.value.name)}&path=${encodeURIComponent(inner.value)}`);
		error.value = '';
		selected.value = selected.value.filter(key => items.value.some(item => item.ulid === key));
	} catch (cause) {
		error.value = message(cause, 'Could not read storage.');
	} finally {
		loading.value = false;
	}
}

/** Runs a change, then shows the folder again; a failure is shown above the browser. */
async function change(work: () => Promise<unknown>) {
	try { await work(); error.value = ''; } catch (cause) { error.value = message(cause, 'That did not work.'); }
	await load();
}

const changeStorage = (input: { action: 'mkdir' | 'move' | 'delete'; path: string; to?: string }) => props.source.send('POST', 'storage/changes', { ...input, disk: disk.value!.name });

function navigate(event: { path: string }) {
	path.value = event.path || '/';
	selected.value = [];
	confirming.value = false;
	error.value = '';
	void load();
}

async function createFolder() {
	const name = newFolderName(listing.value?.entries.map(entry => entry.name) ?? []);
	await change(() => changeStorage({ action: 'mkdir', path: joinPath(inner.value, name) }));
	selected.value = [`/${disk.value!.name}${joinPath(inner.value, name)}`];
}

async function rename(event: { item: StorageItem; name: string }) {
	const name = event.name.trim();
	if (!name || name === event.item.name) return;
	if (name.includes('/')) { error.value = 'Names cannot contain a slash.'; return; }
	const from = split(event.item.path).inner;
	await change(() => changeStorage({ action: 'move', path: from, to: joinPath(parentPath(from), name) }));
}

async function move(event: { items: StorageItem[]; target: { path: string } }) {
	const into = split(event.target.path).inner;
	await change(async () => {
		for (const item of event.items) {
			const from = split(item.path).inner;
			const to = joinPath(into, item.name);
			if (to !== from) await changeStorage({ action: 'move', path: from, to });
		}
	});
}

/** Uploads files one at a time into the folder they were dropped on, keeping dropped folders' structure. */
async function upload(event: { files: Array<{ file: File; relativePath?: string; name?: string }>; target?: { path: string } | null; path?: string }) {
	const large = event.files.filter(item => item.file.size > MAX_FILE_BYTES);
	const files = event.files.filter(item => !large.includes(item));
	const folder = split(event.target?.path ?? event.path ?? path.value).inner;
	const name = disk.value!.name;
	progress.value = 0;
	await change(async () => {
		for (const [index, item] of files.entries()) {
			await props.source.upload(filePath(name, joinPath(folder, item.relativePath || item.name || item.file.name)), item.file);
			progress.value = Math.round((index + 1) / files.length * 100);
		}
		if (large.length) throw new Error(`${large.map(item => item.file.name).join(', ')} ${large.length === 1 ? 'is' : 'are'} over 50 MB and ${large.length === 1 ? 'was' : 'were'} not uploaded.`);
	});
	progress.value = null;
}

/** Downloads the selected files through the browser's own download. */
function download() {
	for (const item of chosenFiles.value) {
		const link = document.createElement('a');
		link.href = props.source.url(filePath(disk.value!.name, split(item.path).inner));
		link.download = item.name;
		link.click();
	}
}

async function remove() {
	confirming.value = false;
	const paths = chosen.value.map(item => split(item.path).inner);
	await change(async () => { for (const item of paths) await changeStorage({ action: 'delete', path: item }); });
	selected.value = [];
}

/** Opens a file from the browser: folders are handled by navigate, files download. */
function open(event: { item: StorageItem }) {
	if (event.item.type !== 'file') return;
	selected.value = [event.item.ulid];
	download();
}

defineExpose({ reload: load });
watch(() => props.source, () => { disks.value = null; path.value = '/'; void load(); }, { immediate: true });
</script>

<template>
	<section class="flex h-full min-h-0 flex-col bg-canvas text-canvas-fg" data-console-storage>
		<p v-if="readOnly" class="mx-4 mt-4 rounded-lg bg-muted p-3 text-sm text-muted-fg" data-storage-read-only>{{ readOnly }}</p>
		<p v-if="error" role="alert" class="m-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" data-storage-error>{{ error }}</p>
		<p v-if="disks && !disks.length" class="m-4 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-fg">This app has no storage disks.</p>
		<div v-else class="min-h-0 flex-1 overflow-hidden">
			<DomMediaBrowser
				class="flex h-full flex-col !rounded-none !border-0 !shadow-none [&>div.grid]:flex-1 [&_header_h3]:sr-only"
				v-model:selected-keys="selected"
				v-model:mode="mode"
				title="Files"
				:items="items"
				:breadcrumbs="breadcrumbs"
				:current-path="path"
				:loading="loading"
				:inspector="false"
				:can-upload="changeable"
				:can-create-folder="changeable"
				:can-rename="changeable"
				:can-move="changeable"
				:upload-progress="progress"
				:empty-text="atRoot ? 'No disks.' : 'This folder is empty. Drop files here or use Upload files.'"
				@navigate="navigate"
				@create-folder="createFolder"
				@rename="rename"
				@move="move"
				@upload="upload"
				@open="open"
			>
				<template v-if="atRoot" #item="{ item }">
					<div class="flex min-h-32 flex-1 flex-col items-center justify-center gap-2 rounded-lg bg-muted/60 px-2" :data-storage-drive="item.name">
						<svg viewBox="0 0 96 64" class="h-14 w-20 text-muted-fg" fill="none" aria-hidden="true">
							<rect x="8" y="14" width="80" height="38" rx="8" fill="currentColor" fill-opacity="0.1" stroke="currentColor" stroke-width="2.4" />
							<path d="M20 33h34" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity="0.45" />
							<circle cx="74" cy="33" r="3.5" fill="#059669" />
						</svg>
						<span class="text-[11px] text-muted-fg">{{ diskOf(item)?.driver ?? 'disk' }}{{ diskOf(item)?.default ? ' · default' : '' }}</span>
					</div>
				</template>
				<template #toolbar>
					<template v-if="!atRoot">
						<button v-if="changeable" type="button" class="min-h-8 rounded-lg border border-border bg-canvas px-3 text-sm font-medium hover:bg-muted" @click="createFolder">New folder</button>
						<button type="button" class="min-h-8 rounded-lg border border-border bg-canvas px-3 text-sm font-medium hover:bg-muted disabled:opacity-40" :disabled="!chosenFiles.length" @click="download">Download</button>
						<template v-if="changeable && confirming">
							<button type="button" class="min-h-8 rounded-lg bg-destructive px-3 text-sm font-medium text-destructive-fg" data-storage-confirm @click="remove">Delete {{ chosen.length === 1 ? chosen[0]!.name : `${chosen.length} items` }}</button>
							<button type="button" class="min-h-8 rounded-lg border border-border bg-canvas px-3 text-sm font-medium hover:bg-muted" @click="confirming = false">Cancel</button>
						</template>
						<button v-else-if="changeable" type="button" class="min-h-8 rounded-lg border border-border bg-canvas px-3 text-sm font-medium hover:bg-muted disabled:opacity-40" :disabled="!chosen.length" @click="confirming = true">Delete</button>
					</template>
				</template>
			</DomMediaBrowser>
		</div>
	</section>
</template>
