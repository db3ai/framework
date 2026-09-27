import type { WebSocketServiceOptions } from '../websocket';
import type { Knex } from 'knex';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ai, type AIOptions } from '../ai';
import { Apps, type AppDefinitions, type AppServices, type InstalledApps } from '../apps';

import {
	Auth,
	type AuthOptions,
} from '../auth';
import {
	Cache,
	type CacheOptions,
} from '../cache';
import {
	Config,
	type ConfigValues,
} from '../config';
import {
	db as defaultDb,
	destroyDatabase,
} from '../db/connection';
import {
	Database,
	type DatabaseOptions,
} from '../db';
import { InApp, type InAppOptions } from '../in-app';
import { Health, type HealthOptions } from '../health';
import { Mail, type MailOptions } from '../mail';
import { Notifications } from '../notifications';
import { WebSockets } from '../websocket';
import { UserIdentity } from '../auth';
import { Events } from '../events';
import { UrlGenerator, type UrlGeneratorOptions } from '../url';
import {
	Queue,
	type QueueOptions,
} from '../queue';
import {
	Log,
	type LoggingOptions,
} from '../logging';
import {
	Storage,
	type StorageOptions,
} from '../storage';
import { Scheduler } from '../scheduler';
import { Security } from '../security';
import { Serializer, type SerializerOptions } from '../serialization';
import { MediaManager, type MediaOptions } from '../media';
import { RequestContext } from './RequestContext';
import {
	clearActiveApp,
	setActiveApp,
} from './appContext';

/** Application root, service configuration and optional dependencies supplied at bootstrap. */
export interface AppOptions<TApps extends AppDefinitions = {}> {
	/** Optional explicit composition. Omit to discover local apps and marked npm dependencies. */
	apps?: TApps;
	/** App root as a path or file URL; defaults to the working directory at construction. */
	directory?: string | URL;
	/** Provider adapters and extensible ActiveRecord models for app().ai. */
	ai?: AIOptions;
	db?: Knex;
	dbOptions?: DatabaseOptions;
	auth?: Omit<AuthOptions<any>, 'db' | 'requestContext'>;
	config?: ConfigValues | Config;
	/** Application logging configuration or injectable logger driver. */
	log?: LoggingOptions;
	/** Canonical application URL configuration used across all runtimes. */
	url?: UrlGeneratorOptions;
	queue?: QueueOptions;
	/** Authorization policy for application-scoped in-app inboxes. */
	inApp?: InAppOptions;
	/** Optional shared transport for channel events from API and worker processes. */
	webSockets?: WebSocketServiceOptions;
	/** Application health identity and initial component checks. */
	health?: HealthOptions;
	/** Provider-neutral mail delivery used directly and by app().notifications. */
	mail?: MailOptions;
	/** Serializable classes and ActiveRecord models registered with app().serializer. */
	serializer?: SerializerOptions;
	storage?: StorageOptions;
}

/**
 * Application service hub.
 *
 * Keep this as the place where top-level framework capabilities are discovered
 * and wired, not where domain logic itself accumulates.
 */
export class App<TApps extends AppDefinitions = {}> {
	private readonly services = new Map<string, unknown>();
	/** Absolute app root used for conventional server paths, independent of later working-directory changes. */
	readonly directory: string;

	/**
	 * Creates an application service hub and validates configured startup security.
	 *
	 * @param options - Framework services and application configuration.
	 */
	constructor(protected readonly options: AppOptions<TApps> = {}) {
		this.directory = resolve(options.directory instanceof URL ? fileURLToPath(options.directory) : options.directory ?? process.cwd());
		if (options.apps) void this.apps;
		setActiveApp(this);

		if (this.config.has('security')) void this.security;
	}

	/** Returns the app composition registry with optional, inferred public service accessors. */
	get apps(): Apps<TApps> & AppServices<TApps> {
		return this.service('apps', () => new Apps(this, this.options.apps)) as Apps<TApps> & AppServices<TApps>;
	}

	/** Returns the lazy database service with this app's connection, model registry and root directory. */
	get db(): Database {
		return this.service('db', () => {
			return new Database(
				this.resolveDbConnection(),
				this.resolveDatabaseOptions(),
				this.directory,
			);
		});
	}

	/** Returns the durable inbox service using the configured Auth identity model. */
	get inApp(): InApp {
		return this.service('inApp', () => new InApp(this.options.inApp, this.options.auth?.identityModel ?? UserIdentity));
	}

	/** Returns the extensible application health registry. */
	get health(): Health {
		return this.service('health', () => new Health(this.options.health));
	}

	/** Returns the provider-neutral mail service configured for this application. */
	get mail(): Mail {
		return this.service('mail', () => new Mail(this.options.mail));
	}

	/** Returns the notification coordinator for application-owned channel renderers. */
	get notifications(): Notifications<any> {
		return this.service('notifications', () => new Notifications(this.inApp, this.mail, this.options.auth?.identityModel ?? UserIdentity));
	}

	/** Returns authenticated WebSocket endpoints owned by this application's lifecycle. */
	get webSockets(): WebSockets {
		return this.service('webSockets', () => new WebSockets(this, this.options.webSockets));
	}

	get auth(): Auth<any> {
		return this.service('auth', () => new Auth<any>({
			...this.options.auth,
			db: this.db,
			config: this.config,
			requestContext: this.requestContext,
		}));
	}

	get requestContext(): RequestContext {
		return this.service('requestContext', () => new RequestContext());
	}

	/** Returns the application AI service with durable request and conversation history. */
	get ai(): Ai {
		return this.service('ai', () => new Ai(this.options.ai ?? this.config.get<AIOptions>('ai', {})));
	}

	/**
	 * Returns the configured application cache.
	 *
	 * Cache driver selection lives under `config.cache`, keeping backend
	 * connection details out of application code.
	 *
	 * @returns Cache service using the configured named store.
	 */
	get cache(): Cache {
		return this.service('cache', () => new Cache(
			this.config.get<CacheOptions>('cache', {}),
		));
	}

	/**
	 * Returns the typed in-process application event dispatcher.
	 *
	 * @returns Event service shared by framework and application code.
	 */
	get events(): Events {
		return this.service('events', () => new Events());
	}

	/**
	 * Returns the application logger shared by framework and app services.
	 *
	 * @returns Pino-backed logging service with app lifecycle ownership.
	 */
	get log(): Log {
		return this.service('log', () => new Log(this.options.log));
	}

	/**
	 * Returns the canonical application URL generator.
	 *
	 * This is independent of any concrete Fastify, Express, or other server
	 * instance so background processes resolve the same public application URL.
	 *
	 * @returns Shared canonical URL generator.
	 */
	get url(): UrlGenerator {
		return this.service('url', () => new UrlGenerator(this.options.url));
	}

	/**
	 * Returns the configured app config repository.
	 */
	get config(): Config {
		return this.service('config', () => {
			if (this.options.config instanceof Config) {
				return this.options.config;
			}

			return new Config(this.options.config);
		});
	}

	get queue(): Queue {
		return this.service('queue', () => new Queue(
			this.db,
			this.options.queue,
		));
	}

	/**
	 * Returns the application scheduler and attaches queue lifecycle recording.
	 *
	 * @returns Scheduler backed by the active database and queue services.
	 */
	get scheduler(): Scheduler {
		return this.service('scheduler', () => new Scheduler(
			this.db,
			this.queue,
		));
	}

	/**
	 * Returns the central application security service.
	 *
	 * @returns Shared authenticated encryption service.
	 */
	get security(): Security {
		return this.service('security', () => new Security());
	}

	/**
	 * Returns the application serializer and its scoped class/model registry.
	 *
	 * @returns Strict serializer configured for this application process.
	 */
	get serializer(): Serializer {
		return this.service('serializer', () => new Serializer(
			this.options.serializer,
		));
	}

	/**
	 * Returns the configured file storage service.
	 */
	get storage(): Storage {
		return this.service('storage', () => new Storage(this.options.storage));
	}

	/**
	 * Returns the configured media manager.
	 *
	 * Media options are resolved from `config.media`, allowing applications to
	 * place derived image variants on a disposable storage disk.
	 *
	 * @returns Media manager backed by configured durable and temporary storage.
	 */
	get media(): MediaManager {
		return this.service('media', () => new MediaManager(
			this.storage,
			this.config.get<MediaOptions>('media', {}),
		));
	}

	/**
	 * Registers a concrete service instance.
	 *
	 * Useful for tests and for services that are built by a provider.
	 */
	set<TService>(name: string, service: TService): this {
		this.services.set(name, service);
		return this;
	}

	/**
	 * Returns a configured service, creating and caching it on first access.
	 */
	service<TService>(name: string, factory: () => TService): TService {
		const existing = this.services.get(name);

		if (existing) {
			return existing as TService;
		}

		const created = factory();

		this.services.set(name, created);

		return created;
	}

	/**
	 * Closes shared resources owned by the default app.
	 */
	async close(): Promise<void> {
		const errors: unknown[] = [];
		/** Continues releasing host resources when an app or transport disposer fails. */
		const release = async (cleanup: () => void | Promise<void>): Promise<void> => {
			try { await cleanup(); } catch (error) { errors.push(error); }
		};
		await release(() => (this.services.get('apps') as Apps | undefined)?.close());
		await release(() => (this.services.get('webSockets') as WebSockets | undefined)?.close());
		clearActiveApp(this);

		await release(() => (this.services.get('scheduler') as Scheduler | undefined)?.close());
		await release(() => (this.services.get('events') as Events | undefined)?.clear());
		await release(() => (this.services.get('cache') as Cache | undefined)?.close());
		await release(() => (this.services.get('log') as Log | undefined)?.close());

		if (!this.options.db) {
			await release(() => destroyDatabase());
		}

		this.services.clear();
		if (errors.length) throw new AggregateError(errors, 'Application shutdown failed.');
	}

	private resolveDbConnection(): Knex {
		if (!this.options.db) {
			return defaultDb();
		}

		return this.options.db;
	}

	private resolveDatabaseOptions(): DatabaseOptions {
		return {
			...this.options.dbOptions,
			syncColumns: this.options.dbOptions?.syncColumns
				?? parseOptionalBoolean(process.env.DB_SYNC_COLUMNS)
				?? true,
		};
	}
}

function parseOptionalBoolean(input: string | undefined): boolean | undefined {
	if (input === undefined || input === '') {
		return undefined;
	}

	switch (input.toLowerCase().trim()) {
		case '1':
		case 'true':
		case 'yes':
		case 'on':
			return true;

		case '0':
		case 'false':
		case 'no':
		case 'off':
			return false;

		default:
			throw new Error(
				`Invalid DB_SYNC_COLUMNS value "${input}". Use true or false.`,
			);
	}
}

/** Optional discovered app services, generated from root App.ts classes by DB3 tooling. */
export interface App<TApps extends AppDefinitions = {}> extends InstalledApps {}
