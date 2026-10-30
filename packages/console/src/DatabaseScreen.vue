<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { DomDataGrid, DomPagination, DomSelect, type DataGridColumn } from '@getdom/studio/vue';
import type { ConsoleColumn, ConsoleLinkOptions, ConsoleRows, ConsoleTable } from '@db3.ai/app/console';
import { choicesOf, controlFor, editable, formFor, labelFor, linkTarget, rowKey, rowValues, settingFor, sourceText } from './databaseView';
import type { ConsoleSource } from './source';

/**
 * An app's database: its tables, a page of rows in getdom.studio's data grid, and a form beside
 * it to add, change or delete a row. Field types come from the columns and foreign keys, and a
 * table's field settings (labels, types, choices, links) override them. The same screen runs in
 * Dock against your running app and in db3 Cloud against an environment.
 */
const props = defineProps<{ source: ConsoleSource; label?: string }>();

const tables = ref<ConsoleTable[] | null>(null);
const tableName = ref('');
const page = ref<ConsoleRows | null>(null);
const pageNumber = ref(1);
const pageSize = ref(25);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const formError = ref('');
const saved = ref(false);
/** The row open in the form: null for none, 'new' for a new row, else its index on the page. */
const open = ref<number | 'new' | null>(null);
const form = ref<Record<string, string | boolean>>({});
const confirming = ref(false);
/** Options loaded for each link column; revision drops answers that arrive after a newer search. */
const links = ref<Record<string, { options: { value: string; label: string }[]; loading: boolean; more: boolean; revision: number }>>({});

const table = computed(() => tables.value?.find(item => item.name === tableName.value) ?? null);
const row = computed(() => typeof open.value === 'number' ? page.value?.rows[open.value] ?? null : null);
const gridRows = computed(() => (page.value?.rows ?? []).map((item, index) => ({ ...item, __index: index })));
const selectedKeys = computed(() => typeof open.value === 'number' ? [open.value] : []);
const columns = computed<DataGridColumn[]>(() => (table.value?.columns ?? []).map(column => ({
	key: column.name, label: labelFor(table.value, column), sortable: false, filterable: false, width: column.primary ? 230 : 190,
	type: control(column) === 'number' ? 'number' : 'text',
	format: (value: unknown) => {
		if (column.secret) return 'Hidden';
		if (value === null || value === undefined) return '';
		if (control(column) === 'boolean') return value === '1' ? 'Yes' : value === '0' ? 'No' : '';
		if (control(column) === 'link') return page.value?.linkLabels?.[column.name]?.[String(value)] ?? String(value);
		return String(value);
	},
})));

const tablePath = (suffix = '') => `database/tables/${encodeURIComponent(tableName.value)}${suffix}`;
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;

/** The form control for a column, with the table's settings applied. */
function control(column: ConsoleColumn) {
	return controlFor(column, settingFor(table.value, column));
}

/** A link column's dropdown options, keeping the selected row listed even when the search left it out. */
function linkOptions(column: ConsoleColumn) {
	const selected = String(form.value[column.name] ?? '');
	const loaded = links.value[column.name]?.options ?? [];
	if (!selected || loaded.some(option => option.value === selected)) return loaded;
	return [{ value: selected, label: page.value?.linkLabels?.[column.name]?.[selected] ?? selected }, ...loaded];
}

/** Searches the rows a link column can point to. */
async function queryLink(column: ConsoleColumn, q: string) {
	const state = links.value[column.name] ?? (links.value[column.name] = { options: [], loading: false, more: false, revision: 0 });
	const revision = ++state.revision;
	state.loading = true;
	try {
		const result = await props.source.get<ConsoleLinkOptions>(`${tablePath('/options')}?${new URLSearchParams({ column: column.name, q })}`);
		if (revision === state.revision) { state.options = result.options; state.more = result.more; }
	} catch (cause) {
		if (revision === state.revision) formError.value = message(cause, 'Could not list the linked rows.');
	} finally {
		if (revision === state.revision) state.loading = false;
	}
}

async function loadTables() {
	loading.value = true;
	try {
		tables.value = (await props.source.get<{ tables: ConsoleTable[] }>('database/tables')).tables;
		error.value = '';
		if (!table.value) tableName.value = tables.value.find(item => !item.readOnly)?.name ?? tables.value[0]?.name ?? '';
		if (tableName.value) await loadRows();
	} catch (cause) {
		error.value = message(cause, 'Could not read the database.');
	} finally {
		loading.value = false;
	}
}

async function loadRows() {
	if (!tableName.value) return;
	loading.value = true;
	try {
		page.value = await props.source.get<ConsoleRows>(`${tablePath('/rows')}?page=${pageNumber.value}&limit=${pageSize.value}`);
		error.value = '';
	} catch (cause) {
		error.value = message(cause, 'Could not read the rows.');
	} finally {
		loading.value = false;
	}
}

function pick(name: string) {
	tableName.value = name; pageNumber.value = 1; open.value = null; page.value = null; links.value = {}; saved.value = false;
	void loadRows();
}

function changePage(next: number) { pageNumber.value = next; open.value = null; void loadRows(); }

/** Opens a row from the grid in the form. */
function edit(event: { row: Record<string, unknown> }) {
	if (!table.value) return;
	open.value = Number(event.row.__index);
	form.value = formFor(table.value, row.value);
	formError.value = ''; saved.value = false; confirming.value = false;
}

function addRow() {
	if (!table.value) return;
	open.value = 'new';
	form.value = formFor(table.value, null);
	formError.value = ''; saved.value = false; confirming.value = false;
}

/** Runs a row write, then reads the page again; a refusal stays on the form. */
async function write(path: string, body: object, after: () => void) {
	saving.value = true; formError.value = '';
	try { await props.source.send('POST', tablePath(`/rows${path}`), body); after(); await loadRows(); }
	catch (cause) { formError.value = message(cause, 'That did not save.'); }
	finally { saving.value = false; }
}

async function save() {
	const current = table.value!;
	const values = rowValues(current, form.value, row.value);
	if (open.value === 'new') {
		await write('', { values }, () => { open.value = null; saved.value = true; });
		if (!formError.value && page.value) { pageNumber.value = Math.max(1, Math.ceil(page.value.total / pageSize.value)); await loadRows(); }
		return;
	}
	if (!Object.keys(values).length) { saved.value = true; return; }
	const index = open.value as number;
	await write('/update', { key: rowKey(current, row.value!), values }, () => { saved.value = true; });
	if (!formError.value && page.value?.rows[index]) form.value = formFor(current, page.value.rows[index]!);
}

async function remove() {
	confirming.value = false;
	await write('/delete', { key: rowKey(table.value!, row.value!) }, () => { open.value = null; });
}

defineExpose({ reload: loadTables });
watch(() => props.source, () => { tables.value = null; tableName.value = ''; open.value = null; pageNumber.value = 1; void loadTables(); }, { immediate: true });
</script>

<template>
	<section class="flex h-full min-h-0 flex-col bg-canvas text-canvas-fg" data-console-database>
		<div v-if="error" role="alert" class="m-4 flex flex-wrap items-center gap-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" data-database-error>
			<span>{{ error }}</span>
			<button type="button" class="font-medium underline" @click="loadTables">Try again</button>
		</div>
		<p v-if="!tables && loading" class="m-4 rounded-xl border border-dashed border-border p-6 text-sm text-muted-fg">Reading {{ label ?? 'the database' }}…</p>
		<p v-else-if="tables && !tables.length" class="m-4 rounded-xl border border-dashed border-border p-6 text-sm text-muted-fg" data-database-empty>This database has no tables yet. Run the app's migrations to create them.</p>

		<div v-else-if="tables" class="grid min-h-0 flex-1 lg:grid-cols-[210px_minmax(0,1fr)]">
			<nav class="border-b border-border p-2 lg:overflow-y-auto lg:border-b-0 lg:border-r" aria-label="Tables">
				<p class="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-fg">Tables</p>
				<button v-for="item in tables" :key="item.name" type="button" class="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm" :class="item.name === tableName ? 'bg-accent font-medium text-accent-fg' : 'hover:bg-muted'" :aria-current="item.name === tableName ? 'true' : undefined" :data-database-table="item.name" @click="pick(item.name)">
					<span class="truncate font-mono text-xs">{{ item.name }}</span>
					<span class="flex-none text-[11px] tabular-nums text-muted-fg">{{ item.readOnly ? 'read-only' : item.rows.toLocaleString() }}</span>
				</button>
			</nav>

			<div v-if="table" class="grid min-h-0 min-w-0 xl:grid-cols-[minmax(0,1fr)_340px]">
				<div class="min-w-0 overflow-y-auto">
					<header class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
						<h2 class="font-mono text-sm font-semibold">{{ table.name }}</h2>
						<span v-if="sourceText(table)" class="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-fg" data-table-source>{{ sourceText(table) }}</span>
						<span class="text-xs text-muted-fg">{{ table.columns.length }} columns · {{ (page?.total ?? table.rows).toLocaleString() }} rows</span>
						<span v-if="table.readOnly" class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-fg" data-table-readonly>{{ table.readOnly }}</span>
						<button v-if="!table.readOnly" type="button" class="ml-auto min-h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-fg" :disabled="saving" @click="addRow">Add row</button>
					</header>
					<DomDataGrid class="min-w-0 !rounded-none !border-x-0 !border-t-0 !shadow-none" :rows="gridRows" :columns="columns" row-key="__index" :selected-keys="selectedKeys" :loading="loading" remote :selectable="false" :toolbar="false" :show-row-numbers="false" :show-column-letters="false" :empty-text="table.readOnly ? 'No rows.' : 'No rows yet. Add the first one.'" @row-click="edit" />
					<div class="flex flex-wrap items-center gap-4 border-t border-border px-4 py-3 text-xs text-muted-fg">
						<label class="flex items-center gap-2">Rows per page
							<select v-model.number="pageSize" class="rounded border border-border bg-canvas p-1" :disabled="loading" @change="changePage(1)"><option :value="10">10</option><option :value="25">25</option><option :value="50">50</option><option :value="100">100</option></select>
						</label>
						<DomPagination class="min-w-0 flex-1" :page="pageNumber" :page-size="pageSize" :total="page?.total ?? 0" :disabled="loading" label="Table rows pagination" @update:page="changePage" />
					</div>
				</div>

				<aside class="min-w-0 border-t border-border xl:overflow-y-auto xl:border-l xl:border-t-0" aria-label="Row editor" data-row-editor>
					<div class="flex items-center justify-between border-b border-border px-4 py-3">
						<h3 class="text-sm font-semibold">{{ open === 'new' ? 'New row' : open === null ? 'Row' : 'Edit row' }}</h3>
						<button v-if="open !== null" type="button" class="rounded-lg px-2 text-muted-fg hover:bg-muted" aria-label="Close row editor" @click="open = null">✕</button>
					</div>
					<p v-if="open === null" class="px-4 py-10 text-center text-sm text-muted-fg">{{ saved ? 'Saved.' : table.readOnly ? 'Click a row to see all its values.' : 'Click a row to change it, or add a new one.' }}</p>
					<form v-else class="space-y-3 p-4" @submit.prevent="save">
						<template v-for="column in table.columns" :key="column.name">
							<label v-if="open !== 'new' || editable(column, false)" class="block text-sm" :data-row-field="column.name">
								<span class="flex items-baseline justify-between gap-2"><span class="text-xs font-medium" :class="settingFor(table, column).label ? '' : 'font-mono'">{{ labelFor(table, column) }}</span><span class="text-[11px] text-muted-fg">{{ linkTarget(table, column) ? `→ ${linkTarget(table, column)}` : column.columnType }}{{ column.primary ? ' · key' : '' }}</span></span>
								<span v-if="settingFor(table, column).help" class="mt-0.5 block text-[11px] text-muted-fg">{{ settingFor(table, column).help }}</span>
								<span v-if="column.secret" class="mt-1 block rounded-lg bg-muted px-3 py-2 text-xs text-muted-fg">Hidden. Secrets stay in the app.</span>
								<input v-else-if="control(column) === 'boolean'" v-model="form[column.name]" type="checkbox" class="mt-1 block h-4 w-4" :disabled="!editable(column, open !== 'new') || Boolean(table.readOnly)" :aria-label="column.name">
								<select v-else-if="control(column) === 'choice'" v-model="form[column.name]" class="mt-1 block w-full rounded-lg border border-input bg-canvas px-2 py-1.5 text-sm" :disabled="!editable(column, open !== 'new') || Boolean(table.readOnly)" :aria-label="column.name"><option v-if="column.nullable" value="">—</option><option v-for="choice in choicesOf(column, settingFor(table, column))" :key="choice" :value="choice">{{ choice }}</option></select>
								<DomSelect v-else-if="control(column) === 'link' && editable(column, open !== 'new') && !table.readOnly" v-model="form[column.name] as string" class="mt-1" :label="column.name" :options="linkOptions(column)" searchable :filter-options="false" :loading="links[column.name]?.loading" :clearable="column.nullable" placeholder="Pick a row" search-placeholder="Search rows…" @query="queryLink(column, $event)" />
								<textarea v-else-if="control(column) === 'textarea'" v-model="form[column.name] as string" rows="3" class="mt-1 block w-full rounded-lg border border-input bg-canvas px-2 py-1.5 font-mono text-xs" :readonly="!editable(column, open !== 'new') || Boolean(table.readOnly)" :aria-label="column.name" />
								<input v-else v-model="form[column.name] as string" :type="control(column) === 'date' ? 'date' : control(column) === 'email' ? 'email' : control(column) === 'url' ? 'url' : 'text'" :inputmode="control(column) === 'number' ? 'decimal' : undefined" class="mt-1 block w-full rounded-lg border border-input bg-canvas px-2 py-1.5 font-mono text-xs" :readonly="!editable(column, open !== 'new') || Boolean(table.readOnly)" :placeholder="control(column) === 'datetime' ? 'YYYY-MM-DD HH:MM:SS' : column.nullable ? 'empty' : ''" :aria-label="column.name">
								<span v-if="control(column) === 'link' && open !== 'new' && form[column.name] && (!editable(column, true) || table.readOnly)" class="mt-1 block text-[11px] text-muted-fg">{{ page?.linkLabels?.[column.name]?.[String(form[column.name])] ?? '' }}</span>
							</label>
						</template>
						<p v-if="formError" role="alert" class="rounded-lg bg-destructive/10 p-2 text-xs text-destructive" data-row-error>{{ formError }}</p>
						<p v-if="saved && open !== 'new'" role="status" class="text-xs text-success">Saved.</p>
						<div v-if="!table.readOnly" class="flex items-center justify-between gap-3 border-t border-border pt-3">
							<button v-if="open !== 'new' && !confirming" type="button" class="text-xs text-destructive" :disabled="saving" @click="confirming = true">Delete row</button>
							<span v-else-if="confirming" class="flex items-center gap-3 text-xs"><button type="button" class="font-semibold text-destructive" data-row-confirm-delete @click="remove">Delete it</button><button type="button" @click="confirming = false">Keep</button></span>
							<span v-else />
							<button type="submit" class="min-h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg disabled:opacity-50" :disabled="saving">{{ saving ? 'Saving…' : open === 'new' ? 'Add row' : 'Save changes' }}</button>
						</div>
					</form>
				</aside>
			</div>
		</div>
	</section>
</template>
