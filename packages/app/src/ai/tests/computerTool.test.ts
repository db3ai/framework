import { describe, expect, it } from 'vitest';
import { computerTool, type Computer } from '@db3.ai/app/ai';

/** Models the external SDK computer contract without introducing a framework execution loop. */
class ConsumerComputer implements Computer {
	readonly environment = 'browser' as const;
	readonly dimensions = [1360, 900] as [number, number];
	/** Returns the image supplied by the consumer's browser adapter. */
	async screenshot(): Promise<string> { return 'external-screenshot'; }
	/** Delegates pointer input to the consumer-owned environment. */
	async click(): Promise<void> {}
	/** Delegates repeated pointer input to the consumer-owned environment. */
	async doubleClick(): Promise<void> {}
	/** Delegates scrolling to the consumer-owned environment. */
	async scroll(): Promise<void> {}
	/** Delegates text entry to the consumer-owned environment. */
	async type(): Promise<void> {}
	/** Delegates waiting to the consumer-owned environment. */
	async wait(): Promise<void> {}
	/** Delegates pointer movement to the consumer-owned environment. */
	async move(): Promise<void> {}
	/** Delegates key input to the consumer-owned environment. */
	async keypress(): Promise<void> {}
	/** Delegates dragging to the consumer-owned environment. */
	async drag(): Promise<void> {}
}

describe('Public computer tool contract', () => {
	it('exports the SDK tool and typed consumer-owned computer through the public AI subpath', async () => {
		const computer = new ConsumerComputer();
		const tool = computerTool({ name: 'computer', computer });
		expect(tool.type).toBe('computer');
		expect(tool.name).toBe('computer');
		expect(tool.computer).toBe(computer);
		expect(await computer.screenshot()).toBe('external-screenshot');
	});
});
