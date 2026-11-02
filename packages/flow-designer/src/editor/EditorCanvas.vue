<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { FlowBlockMetadata, FlowGraphDefinition } from '@db3.ai/app/flows';
import type { FlowStepRunRecord } from '../contracts';
import { ERROR_EXIT, NODE_WIDTH, START, blockKind, edgeSource, stepExits } from './graph';

/**
 * The flow drawn as boxes and lines. Boxes are dragged to move them, a line is drawn
 * by dragging from an exit dot onto another box, and a line is selected by clicking it.
 * The parent owns the flow and applies every change this emits.
 */
const props = defineProps<{
	flow: FlowGraphDefinition;
	blocks: Map<string, FlowBlockMetadata>;
	/** Selected step name, `input` for Start, or `edge:<index>`. */
	selected: string | null;
	/** Problem count per step name. */
	problems: Record<string, number>;
	/** Step states of the run being shown, by step name. */
	steps?: Record<string, FlowStepRunRecord> | null;
	editable: boolean;
}>();

const emit = defineEmits<{
	select: [key: string | null];
	move: [name: string, at: [number, number]];
	connect: [from: string, to: string];
	open: [name: string];
	drop: [type: string, at: [number, number]];
}>();

const HEADER = 52;
const ROW = 22;
const canvas = ref<HTMLElement | null>(null);
const drag = ref<{ name: string; dx: number; dy: number; pointer: number } | null>(null);
const draft = ref<{ from: string; x1: number; y1: number; x2: number; y2: number } | null>(null);

/** One box: Start, or a step with its exits. */
interface Box {
	key: string;
	title: string;
	sub: string;
	kind: string;
	x: number;
	y: number;
	exits: string[];
	showError: boolean;
	triggers: string[];
}

const boxes = computed<Box[]>(() => {
	const layout = props.flow.layout ?? {};
	const start = layout[START] ?? [40, 160];
	const triggers = Object.entries(props.flow.triggers ?? {}).map(([name, trigger]) => `${name} · ${trigger.type.replace(/^trigger\./, '')}`);
	const list: Box[] = [{
		key: START, title: 'Start', sub: Object.keys(props.flow.inputs).join(', ') || 'no inputs yet', kind: 'start',
		x: start[0], y: start[1], exits: [], showError: false, triggers: triggers.length ? triggers : ['flows.start() from code'],
	}];

	for (const [name, step] of Object.entries(props.flow.steps)) {
		const block = props.blocks.get(step.type);
		const at = layout[name] ?? [300, 160];
		const wiredError = props.flow.edges.some(([from]) => from === `${name}.${ERROR_EXIT}`);
		list.push({
			key: name,
			title: step.title || block?.name || name,
			sub: name,
			kind: block ? blockKind(block) : 'app',
			x: at[0], y: at[1],
			exits: stepExits(step, block),
			showError: wiredError || (props.editable && props.selected === name),
			triggers: [],
		});
	}
	return list;
});

const byKey = computed(() => new Map(boxes.value.map(box => [box.key, box])));

/** Rows below the header that hold exits (named plus error). */
function exitRows(box: Box): string[] {
	if (!box.exits.length && !box.showError) return [];
	return [...box.exits, ...(box.showError ? [ERROR_EXIT] : [])];
}

function boxHeight(box: Box): number {
	if (box.triggers.length) return HEADER + 10 + box.triggers.length * 18;
	const rows = exitRows(box).length;
	return rows ? HEADER + 6 + rows * ROW : HEADER;
}

/** Where a line leaves: the plain output dot or an exit row's dot. */
function outPoint(source: string): [number, number] | null {
	const { step, exit } = edgeSource(source);
	const box = byKey.value.get(step);
	if (!box) return null;
	if (exit === null) return [box.x + NODE_WIDTH, box.y + 26];
	const index = exitRows(box).indexOf(exit);
	if (index < 0) return [box.x + NODE_WIDTH, box.y + 26];
	return [box.x + NODE_WIDTH, box.y + HEADER + 3 + index * ROW + 11];
}

function inPoint(name: string): [number, number] | null {
	const box = byKey.value.get(name);
	return box ? [box.x, box.y + 26] : null;
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
	const dx = Math.max(40, Math.abs(x2 - x1) / 2);
	return `M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2 - 2} ${y2}`;
}

const lines = computed(() => props.flow.edges.flatMap(([from, to], index) => {
	const a = outPoint(from);
	const b = inPoint(to);
	if (!a || !b) return [];
	const { step, exit } = edgeSource(from);
	const source = props.steps?.[step];
	const target = props.steps?.[to];
	const dead = Boolean(props.steps) && (target?.status === 'skipped' || source?.status === 'skipped'
		|| (source?.status === 'completed' && (source.exit ?? null) !== exit)
		|| (source?.status === 'failed' && exit !== ERROR_EXIT));
	return [{ index, d: curve(a[0], a[1], b[0], b[1]), dead, error: exit === ERROR_EXIT }];
}));

const size = computed(() => {
	const right = Math.max(...boxes.value.map(box => box.x + NODE_WIDTH)) + 320;
	const bottom = Math.max(...boxes.value.map(box => box.y + boxHeight(box))) + 240;
	return { width: Math.max(right, 900), height: Math.max(bottom, 520) };
});

function point(event: PointerEvent | DragEvent): [number, number] {
	const rect = canvas.value!.getBoundingClientRect();
	return [event.clientX - rect.left, event.clientY - rect.top];
}

function startDrag(event: PointerEvent, box: Box): void {
	emit('select', box.key);
	if (!props.editable || event.button !== 0) return;
	const [x, y] = point(event);
	drag.value = { name: box.key, dx: x - box.x, dy: y - box.y, pointer: event.pointerId };
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function startLine(event: PointerEvent, source: string): void {
	if (!props.editable) return;
	event.stopPropagation();
	const start = outPoint(source);
	if (!start) return;
	draft.value = { from: source, x1: start[0], y1: start[1], x2: start[0], y2: start[1] };
	window.addEventListener('pointermove', moveLine);
	window.addEventListener('pointerup', endLine, { once: true });
}

function moveLine(event: PointerEvent): void {
	if (!draft.value) return;
	const [x, y] = point(event);
	draft.value = { ...draft.value, x2: x, y2: y };
}

function endLine(event: PointerEvent): void {
	window.removeEventListener('pointermove', moveLine);
	const from = draft.value?.from;
	draft.value = null;
	const target = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-step]');
	if (from && target?.dataset.step && target.dataset.step !== START) emit('connect', from, target.dataset.step);
}

function onMove(event: PointerEvent): void {
	if (!drag.value || event.pointerId !== drag.value.pointer) return;
	const [x, y] = point(event);
	emit('move', drag.value.name, [Math.max(0, Math.round(x - drag.value.dx)), Math.max(0, Math.round(y - drag.value.dy))]);
}

function onDrop(event: DragEvent): void {
	const type = event.dataTransfer?.getData('application/x-db3-block');
	if (!type || !props.editable) return;
	const [x, y] = point(event);
	emit('drop', type, [Math.max(0, x - NODE_WIDTH / 2), Math.max(0, y - 26)]);
}

function status(name: string): { label: string; css: string } | null {
	const step = props.steps?.[name];
	if (!props.steps) return null;
	if (!step) return name === START ? { label: 'started', css: 'st-completed' } : null;
	const label = step.status === 'completed' && step.exit ? step.exit : step.status === 'failed' && step.exit === ERROR_EXIT ? 'failed → error' : step.status;
	return { label: step.attempt > 1 && step.status !== 'skipped' ? `${label} · try ${step.attempt}` : label, css: `st-${step.status}` };
}

onBeforeUnmount(() => window.removeEventListener('pointermove', moveLine));
</script>

<template>
	<div
		ref="canvas"
		class="fe-canvas"
		:style="{ width: `${size.width}px`, height: `${size.height}px` }"
		@pointerdown.self="emit('select', null)"
		@pointermove="onMove"
		@pointerup="drag = null"
		@dragover.prevent
		@drop.prevent="onDrop"
	>
		<svg class="edges" :width="size.width" :height="size.height" aria-hidden="true">
			<defs>
				<marker id="fe-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
					<path d="M0 0L10 5L0 10z" fill="var(--fe-edge)" />
				</marker>
			</defs>
			<g v-for="line in lines" :key="line.index">
				<path class="line" :class="{ sel: selected === `edge:${line.index}`, dead: line.dead, err: line.error }" :d="line.d" marker-end="url(#fe-arrow)" />
				<path class="hit" :d="line.d" fill="none" :data-edge="line.index" @pointerdown.stop="emit('select', `edge:${line.index}`)" />
			</g>
			<path v-if="draft" class="draft" :d="curve(draft.x1, draft.y1, draft.x2, draft.y2)" />
		</svg>

		<div
			v-for="box in boxes"
			:key="box.key"
			class="fe-node"
			:class="[`k-${box.kind}`, { sel: selected === box.key, start: box.key === START, problem: problems[box.key], skipped: steps?.[box.key]?.status === 'skipped' }]"
			:style="{ left: `${box.x}px`, top: `${box.y}px` }"
			:data-step="box.key"
			tabindex="0"
			@pointerdown="startDrag($event, box)"
			@dblclick="emit('open', box.key)"
			@keydown.enter.prevent="emit('open', box.key)"
		>
			<span v-if="problems[box.key]" class="fe-badge issue">{{ problems[box.key] }} problem{{ problems[box.key] > 1 ? 's' : '' }}</span>
			<span v-if="status(box.key)" class="fe-badge status" :class="status(box.key)!.css">{{ status(box.key)!.label }}</span>
			<header>
				<span class="fe-tile" :class="`k-${box.kind}`">
					<svg v-if="box.kind === 'start'" viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" /></svg>
					<template v-else>{{ box.title.slice(0, 1).toUpperCase() }}</template>
				</span>
				<span><b>{{ box.title }}</b><small>{{ box.sub }}</small></span>
			</header>
			<div v-if="box.triggers.length" class="triggers">
				<div v-for="trigger in box.triggers" :key="trigger">{{ trigger }}</div>
			</div>
			<div v-if="exitRows(box).length" class="exits">
				<div v-for="exit in exitRows(box)" :key="exit" class="exit" :class="{ err: exit === 'error', taken: steps?.[box.key]?.exit === exit }">
					{{ exit }}
					<span class="fe-port out" :title="`Drag to connect ${exit}`" @pointerdown="startLine($event, `${box.key}.${exit}`)" />
				</div>
			</div>
			<span v-if="box.key !== START" class="fe-port in" />
			<span v-if="!box.exits.length" class="fe-port out" title="Drag to connect" @pointerdown="startLine($event, box.key)" />
		</div>
	</div>
</template>
