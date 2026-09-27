import { z } from 'zod';
import { Agent, tool, type AgentTool, type BaseAgentContext } from '@db3.ai/app/ai';
import { app } from '@db3.ai/app/server';

/** Trusted context supplied by your route or job, never selected by the model. */
export interface HelpAgentContext extends BaseAgentContext {
	guidePath: string;
}

/** Answers questions using a help guide saved by your application. */
export class HelpAgent extends Agent<HelpAgentContext> {
	/** Gives the agent its task and source of truth. */
	async instructions(): Promise<string> {
		return 'Answer questions about this app using its saved help guide. Read the guide before answering. If the answer is absent, say so.';
	}

	/** Exposes one function with validated arguments and a server-selected file path. */
	protected tools(): AgentTool[] {
		return [Object.assign(tool({
			name: 'read_help_guide',
			description: 'Read the application help guide.',
			parameters: z.object({}),
			/** Reads only the file selected by trusted application code. */
			execute: async () => app().storage.getText(this.context.guidePath),
		}), { title: 'Read help guide', description: 'Read the application help guide.' })];
	}
}
