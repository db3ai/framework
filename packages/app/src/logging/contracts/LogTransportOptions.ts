import type { LogTransport } from './LogTransport';
import type { EmailLogOptions } from './EmailLogOptions';
import type { LogLevel } from './Logger';
import type { DevtoolsLogOptions } from './LoggingOptions';

/** A configured destination receiving records at its minimum severity or above. */
export type LogTransportOptions =
	| { type: 'custom'; level?: LogLevel; /** Creates a fresh destination owned by this logger; omitted for silent routes. */ create: () => LogTransport }
	| { type: 'console'; level?: LogLevel }
	| { type: 'file'; level?: LogLevel; destination: string }
	| ({ type: 'email'; level?: LogLevel } & EmailLogOptions)
	| { type: 'devtools'; level?: LogLevel; options?: DevtoolsLogOptions };
