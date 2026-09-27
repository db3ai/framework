import { DevelopmentConsole } from './DevelopmentConsole';

let active: DevelopmentConsole | undefined;
let leases = 0;

/** Shares one terminal owner across application loggers in the same process. */
export function acquireDevelopmentConsole(): { console: DevelopmentConsole; release: () => void } {
	active ??= new DevelopmentConsole();
	leases++;
	let released = false;
	return {
		console: active,
		release: () => {
			if (released) return;
			released = true;
			if (--leases === 0) { active?.close(); active = undefined; }
		},
	};
}
