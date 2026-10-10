import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

import type { OutputChunk } from '../../shared/contracts.js';
import { onThemeChange, terminalTheme } from './terminalTheme.js';

/** What a terminal pane feeds into and reads out of {@link useXterm}. */
export interface XtermOptions {
	/** The process's raw output so far; a new array whenever chunks arrive or output is cleared. */
	chunks: () => OutputChunk[];
	/** Whether keystrokes go to the process (running inside Dock). */
	interactive: () => boolean;
	/** CSS token for the background, such as `--ground-deep` or `--crashed`. */
	background: () => string;
	onInput(data: string): void;
	onResize(cols: number, rows: number): void;
	/** Cmd/Ctrl+K, as in VS Code. */
	onClear(): void;
}

const FONT = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

/**
 * An xterm.js terminal bound to one process, set up the way VS Code's
 * integrated terminal is: WebGL rendering with a DOM fallback, fit to its pane,
 * Cmd/Ctrl+click links, Option as Meta, Cmd/Ctrl+K to clear, and colours from
 * the current light or dark theme.
 *
 * Output is replayed from the process's scrollback on mount and then written as
 * new chunks arrive. The terminal is disposed with its owning component.
 *
 * @param container - Element the terminal renders into.
 * @param options - Output source, input and size callbacks.
 * @returns `focus` for the owning component.
 */
export function useXterm(container: Ref<HTMLElement | null>, options: XtermOptions) {
	let term: Terminal | null = null;
	let fit: FitAddon | null = null;
	let firstSeq = 0;
	let lastSeq = 0;
	let frame = 0;
	let disposed = false;
	const cleanups: Array<() => void> = [];

	onMounted(async () => {
		// Measure the grid with the real font, not a fallback.
		await document.fonts?.load(`12px ${FONT}`).catch(() => undefined);
		if (disposed || !container.value) return;

		term = new Terminal({
			fontFamily: FONT,
			fontSize: 12,
			lineHeight: 1.2,
			scrollback: 5000,
			cursorBlink: true,
			cursorInactiveStyle: 'outline',
			macOptionIsMeta: true,
			disableStdin: !options.interactive(),
			theme: terminalTheme(options.background()),
		});
		fit = new FitAddon();
		term.loadAddon(fit);
		term.loadAddon(new WebLinksAddon((event, uri) => {
			if (event.metaKey || event.ctrlKey) window.open(uri, '_blank', 'noopener');
		}));
		term.attachCustomKeyEventHandler(event => {
			if (event.type === 'keydown' && (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
				options.onClear();
				return false;
			}
			return true;
		});
		term.open(container.value);
		try {
			const webgl = new WebglAddon();
			webgl.onContextLoss(() => webgl.dispose());
			term.loadAddon(webgl);
		} catch {
			// No WebGL here; xterm keeps its DOM renderer.
		}

		term.onData(data => {
			if (options.interactive()) options.onInput(data);
		});
		term.onResize(({ cols, rows }) => options.onResize(cols, rows));

		fitNow();
		options.onResize(term.cols, term.rows);
		write();

		const observer = new ResizeObserver(scheduleFit);
		observer.observe(container.value);
		cleanups.push(() => observer.disconnect());
		cleanups.push(onThemeChange(applyTheme));
	});

	watch(() => options.chunks(), write);
	watch(() => options.interactive(), interactive => {
		if (term) term.options.disableStdin = !interactive;
	});
	watch(() => options.background(), applyTheme);

	onBeforeUnmount(() => {
		disposed = true;
		cancelAnimationFrame(frame);
		for (const cleanup of cleanups.splice(0)) cleanup();
		term?.dispose();
		term = null;
	});

	/** Writes chunks not yet shown; redraws from scratch after a clear or when older history arrives late. */
	function write(): void {
		if (!term) return;
		const chunks = options.chunks();
		if (!chunks.length) {
			if (lastSeq) term.reset();
			firstSeq = lastSeq = 0;
			return;
		}
		let fresh: OutputChunk[];
		if (lastSeq && chunks[0]!.seq < firstSeq) {
			// Older scrollback arrived after live output: redraw in order.
			term.reset();
			fresh = chunks;
			firstSeq = chunks[0]!.seq;
		} else {
			fresh = chunks.filter(chunk => chunk.seq > lastSeq);
			if (!lastSeq) firstSeq = chunks[0]!.seq;
		}
		if (!fresh.length) return;
		lastSeq = fresh[fresh.length - 1]!.seq;
		term.write(fresh.map(chunk => chunk.data).join(''));
	}

	function applyTheme(): void {
		if (term) term.options.theme = terminalTheme(options.background());
	}

	function scheduleFit(): void {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(fitNow);
	}

	function fitNow(): void {
		const element = container.value;
		if (!fit || !element || !element.offsetWidth || !element.offsetHeight) return;
		try {
			fit.fit();
		} catch {
			// Not laid out yet; the next resize fits it.
		}
	}

	return {
		focus: () => term?.focus(),
	};
}
