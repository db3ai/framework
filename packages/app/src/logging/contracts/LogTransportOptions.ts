import type { EmailLogOptions } from './EmailLogOptions';
import type { LogLevel } from './Logger';
import type { DevtoolsLogOptions } from './LoggingOptions';

/** A configured destination receiving records at its minimum severity or above. */
export type LogTransportOptions =
	| { type: 'console'; level?: LogLevel }
	| { type: 'file'; level?: LogLevel; destination: string }
	| ({ type: 'email'; level?: LogLevel } & EmailLogOptions)
	| { type: 'devtools'; level?: LogLevel; options?: DevtoolsLogOptions };
