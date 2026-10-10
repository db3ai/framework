import type { ITheme } from '@xterm/xterm';

const ANSI_NAMES = [
	'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
	'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const;

/**
 * Builds an xterm.js theme from Dock's CSS tokens.
 *
 * The tokens use `light-dark()`, which only a styled element can resolve, so
 * each one is read through a hidden probe that inherits the page's current
 * `color-scheme`. Call again after the theme changes.
 *
 * @param background - Token for the terminal background, such as `--ground-deep` or `--crashed`.
 * @param root - Element whose colour scheme applies.
 * @returns A theme with concrete `rgb()` colours.
 */
export function terminalTheme(background = '--ground-deep', root: HTMLElement = document.body): ITheme {
	const probe = document.createElement('span');
	probe.style.display = 'none';
	root.appendChild(probe);
	const resolve = (token: string) => {
		probe.style.color = `var(${token})`;
		return getComputedStyle(probe).color;
	};
	try {
		const theme: ITheme = {
			background: resolve(background),
			foreground: resolve('--text'),
			cursor: resolve('--text'),
			cursorAccent: resolve(background),
			selectionBackground: withAlpha(resolve('--link'), 0.3),
			selectionInactiveBackground: withAlpha(resolve('--muted'), 0.25),
		};
		ANSI_NAMES.forEach((name, index) => {
			theme[name] = resolve(`--ansi-${index}`);
		});
		return theme;
	} finally {
		probe.remove();
	}
}

/**
 * @param rgb - A computed `rgb(r, g, b)` colour.
 * @param alpha - Opacity 0–1.
 * @returns The colour as `rgba(r, g, b, alpha)`, or the input when it is not `rgb()`.
 */
export function withAlpha(rgb: string, alpha: number): string {
	const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
	return match ? `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})` : rgb;
}

/**
 * Calls back when the page's colour scheme may have changed: the theme menu
 * (`data-theme` on `<html>`) or the operating system's appearance.
 *
 * @param callback - Called on the next frame after a change, once styles apply.
 * @returns Stops listening.
 */
export function onThemeChange(callback: () => void): () => void {
	let frame = 0;
	const notify = () => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(callback);
	};
	const observer = new MutationObserver(notify);
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
	const media = matchMedia('(prefers-color-scheme: dark)');
	media.addEventListener('change', notify);
	return () => {
		cancelAnimationFrame(frame);
		observer.disconnect();
		media.removeEventListener('change', notify);
	};
}
