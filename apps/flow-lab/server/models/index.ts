import { DemoArticle } from './DemoArticle.js';
import { DemoContentPlan } from './DemoContentPlan.js';
import { DemoUser } from './DemoUser.js';
import { DemoWebsitePage } from './DemoWebsitePage.js';

export { DemoArticle, DemoContentPlan, DemoUser, DemoWebsitePage };

/** ActiveRecord models owned exclusively by executable Flow Lab examples. */
export const FLOW_LAB_DEMO_MODELS = [
	DemoUser,
	DemoContentPlan,
	DemoWebsitePage,
	DemoArticle,
];
