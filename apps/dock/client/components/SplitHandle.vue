<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';

/**
 * A 1px divider that resizes the panes beside it, after DOM Studio's splitter:
 * drag with the pointer, or focus it and use the arrow keys (Shift for larger
 * steps). Double-click asks the owner to reset sizes.
 *
 * `move` carries the total distance from where the drag started, so owners
 * compute new sizes from the sizes they recorded on `start`.
 */
const props = defineProps<{
	/** `vertical` is a vertical line between columns; `horizontal` a line between rows. */
	orientation: 'vertical' | 'horizontal';
	label: string;
	/** Current size of the pane this handle resizes, for assistive technology. */
	value?: number;
}>();

const emit = defineEmits<{ start: []; move: [delta: number]; end: []; reset: [] }>();

const dragging = ref(false);
let origin = 0;

function position(event: PointerEvent): number {
	return props.orientation === 'vertical' ? event.clientX : event.clientY;
}

function setDocumentDragging(active: boolean): void {
	document.body.style.cursor = active ? (props.orientation === 'vertical' ? 'col-resize' : 'row-resize') : '';
	document.body.style.userSelect = active ? 'none' : '';
}

function onPointerDown(event: PointerEvent): void {
	if (event.button !== 0) return;
	event.preventDefault();
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	(event.currentTarget as HTMLElement).focus();
	dragging.value = true;
	origin = position(event);
	setDocumentDragging(true);
	emit('start');
}

function onPointerMove(event: PointerEvent): void {
	if (dragging.value) emit('move', position(event) - origin);
}

function stop(): void {
	if (!dragging.value) return;
	dragging.value = false;
	setDocumentDragging(false);
	emit('end');
}

function onKeyDown(event: KeyboardEvent): void {
	const [back, forward] = props.orientation === 'vertical' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
	if (event.key !== back && event.key !== forward) return;
	event.preventDefault();
	const step = (event.shiftKey ? 40 : 10) * (event.key === forward ? 1 : -1);
	emit('start');
	emit('move', step);
	emit('end');
}

onBeforeUnmount(() => {
	if (dragging.value) setDocumentDragging(false);
});
</script>

<template>
	<div
		class="split"
		:class="`split--${props.orientation}`"
		role="separator"
		tabindex="0"
		:aria-orientation="props.orientation"
		:aria-label="props.label"
		:aria-valuenow="props.value === undefined ? undefined : Math.round(props.value)"
		:data-dragging="dragging"
		@pointerdown="onPointerDown"
		@pointermove="onPointerMove"
		@pointerup="stop"
		@pointercancel="stop"
		@lostpointercapture="stop"
		@keydown="onKeyDown"
		@dblclick="emit('reset')"
	/>
</template>

<style scoped>
.split {
	position: relative;
	flex: none;
	z-index: 3;
	background: var(--line);
	touch-action: none;
	transition: background-color 120ms;
}

.split--vertical {
	width: 1px;
	align-self: stretch;
	cursor: col-resize;
}

.split--horizontal {
	height: 1px;
	cursor: row-resize;
}

/* A wider invisible grab area around the 1px line. */
.split::before {
	content: '';
	position: absolute;
}

.split--vertical::before {
	inset: 0 -4px;
}

.split--horizontal::before {
	inset: -4px 0;
}

.split:hover,
.split:focus-visible,
.split[data-dragging='true'] {
	outline: none;
	background: var(--link);
	box-shadow: 0 0 0 1px var(--link);
}
</style>
