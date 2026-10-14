/** A logger-owned destination for complete JSON lines after serialization and field redaction. */
export interface LogTransport {
	/** Accepts one record synchronously; buffer asynchronous delivery with a bounded queue. */
	write(line: string): void;
	/** Drains accepted records with a provider-defined bounded wait. */
	flush(): Promise<void>;
	/** Releases owned resources after the logger flushes. Called once per logger. */
	close?(): Promise<void>;
}
