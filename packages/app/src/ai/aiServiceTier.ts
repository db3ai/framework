import type { AIServiceTier } from './contracts/AIServiceTier';
import { AIConfigurationError } from './AIErrors';

/** Validates explicit tiers before provider work; other providers retain their own defaults. */
export function assertAIServiceTier(provider: string, tier: AIServiceTier): void {
	if (!['default', 'flex', 'fast', 'priority'].includes(tier)) throw new AIConfigurationError('Unsupported AI service tier.');
	if (provider !== 'openai' && tier !== 'default') throw new AIConfigurationError('Explicit AI service tiers require the OpenAI provider.');
}

/** Resolves billed tier without treating an unconfirmed Flex/Fast request as discounted usage. */
export function effectiveAIServiceTier(reported: unknown, requested: unknown): string | null {
	if (typeof reported === 'string' && reported.length > 0) return reported;
	return requested === undefined || requested === 'default' ? 'default' : null;
}
