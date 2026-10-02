import { App } from '@db3.ai/app';
import { app } from '@db3.ai/app/server';
import { appsCommands } from '@db3.ai/app/apps/commands';
import { registerAppRoutes } from '@db3.ai/app/apps/fastify';
import type Social from '@db3.ai/social';
import type { SocialOpportunityData } from '@db3.ai/social/contracts';
import type { AppNavigationContext, AppNavigationResult } from '@db3.ai/app/apps/contracts';
import type { Schedule } from '@db3.ai/app/scheduler';

const host = new App();
const optional: Social | undefined = host.social;
const contextual: Social | undefined = app().social;
const viewer: AppNavigationContext = { actor: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' } };
const navigation: Promise<AppNavigationResult> = host.apps.navigation(viewer);
/** Demonstrates a consuming application's schedule-file signature through public exports. */
function schedule(builder: Schedule): void { builder.call(async () => {}).name('consumer-hourly').hourly(); }
if (contextual) {
	const entries: Promise<SocialOpportunityData[]> = contextual.list('01ARZ3NDEKTSV4RRFFQ69G5FAV');
	void entries;
}
void [optional, appsCommands, registerAppRoutes, navigation, schedule];
