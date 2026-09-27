/**
 * Type-only compatibility for the Agents SDK 0.12 Node shim.
 *
 * Its lifecycle classes promise the SDK's event-map interface but declare their
 * implementation as Node's EventEmitter, whose conditional overloads are not
 * assignable under strict TypeScript checking. Keep Node's other members and
 * static helpers, while describing these four methods with the SDK contract.
 * Runtime imports continue to resolve to the unmodified SDK and Node emitter.
 *
 * This file must remain an ambient script, not a module augmentation. Keep the
 * declarations aligned with the pinned SDK and remove them when an unmodified
 * SDK passes the packed consumer with skipLibCheck disabled.
 */
declare module '@openai/agents-core/_shims' {
	import type { EventEmitter as NodeEventEmitter } from 'node:events';

	/** Event names and their listener argument tuples, as defined by the SDK. */
	export type EventEmitterEvents = Record<string, any[]>;

	/** Common emitter interface used by SDK lifecycle and transport classes. */
	export interface EventEmitter<Events extends EventEmitterEvents = Record<string, any[]>> {
		/** Registers a listener for an event and returns the emitter. */
		on<K extends keyof Events>(type: K, listener: (...args: Events[K]) => void): EventEmitter<Events>;
		/** Removes a previously registered listener and returns the emitter. */
		off<K extends keyof Events>(type: K, listener: (...args: Events[K]) => void): EventEmitter<Events>;
		/** Invokes listeners with the event's argument tuple. */
		emit<K extends keyof Events>(type: K, ...args: Events[K]): boolean;
		/** Registers a listener that is removed after its first invocation. */
		once<K extends keyof Events>(type: K, listener: (...args: Events[K]) => void): EventEmitter<Events>;
	}

	/** Node emitter instance with the event-map contract promised by the SDK. */
	export interface RuntimeEventEmitter<Events extends EventEmitterEvents = Record<string, any[]>> extends Omit<NodeEventEmitter<Events>, keyof EventEmitter<Events>> {
		/** Registers a typed listener while retaining Node's fluent instance API. */
		on<K extends keyof Events>(type: K, listener: (...args: Events[K]) => void): this;
		/** Removes a typed listener and returns the original Node instance. */
		off<K extends keyof Events>(type: K, listener: (...args: Events[K]) => void): this;
		/** Emits the argument tuple for a known SDK event. */
		emit<K extends keyof Events>(type: K, ...args: Events[K]): boolean;
		/** Registers a typed single-use listener and returns the Node instance. */
		once<K extends keyof Events>(type: K, listener: (...args: Events[K]) => void): this;
	}

	/** Unmodified Node constructor and static helpers exported by the SDK. */
	export const RuntimeEventEmitter: Pick<typeof NodeEventEmitter, Exclude<keyof typeof NodeEventEmitter, 'prototype'>> & {
		/** Creates an emitter with the SDK's listener argument tuples. */
		new <Events extends EventEmitterEvents = Record<string, any[]>>(options?: ConstructorParameters<typeof NodeEventEmitter>[0]): RuntimeEventEmitter<Events>;
	};

	export { Readable } from 'node:stream';
	export { ReadableStream, ReadableStreamController, TransformStream } from 'node:stream/web';
	export { AsyncLocalStorage } from 'node:async_hooks';
	export { randomUUID } from 'node:crypto';
	export { clearTimeout } from 'node:timers';
	export { MCPServerStdio, MCPServerStreamableHttp, MCPServerSSE } from '@openai/agents-core';

	/** Node timer handle returned by the SDK's timer adapter. */
	export type Timeout = NodeJS.Timeout;

	/** Timer contract shared by the SDK runtime environments. */
	export interface Timer {
		/** Schedules the callback and returns its Node timer handle. */
		setTimeout(callback: (...args: any[]) => any, ms: number): Timeout;
		/** Cancels a timer previously created by the adapter. */
		clearTimeout(timeoutId: Timeout | string | number | undefined): void;
	}

	/** Timer adapter used by the SDK's Node runtime. */
	export const timer: Timer;
	/** Returns the Node environment without changing it. */
	export function loadEnv(): Record<string, string | undefined>;
	/** Reports whether the Node tracing loop starts by default. */
	export function isTracingLoopRunningByDefault(): boolean;
	/** Reports whether the current SDK adapter is a browser runtime. */
	export function isBrowserEnvironment(): boolean;
}
