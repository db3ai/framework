/** A validated console option value passed to a command adapter. */
export type CliOptionValue = string | number | boolean | readonly string[];

/** Common help and validation metadata for a long console option. */
interface OptionDescription {
	/** Long option name without leading dashes. */
	name: string;
	/** Description shown by command-specific help. */
	description: string;
	/** Whether omission is an error before application startup. */
	required?: boolean;
}

/** Declarative long options shared by the terminal parser and command discovery. */
export type CliOption = OptionDescription & (
	| { type: 'boolean'; default?: boolean }
	| { type: 'string'; default?: string; multiple?: false }
	| { type: 'string'; default?: readonly string[]; multiple: true }
	| { type: 'number'; default?: number; integer?: boolean; min?: number; max?: number }
);
