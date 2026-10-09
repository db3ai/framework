import type { FlowBlockDefinition } from '@db3.ai/app/flows';

import BuildGreeting from './BuildGreeting.js';
import BuildArticleContext from './BuildArticleContext.js';
import DebugTap from './DebugTap.js';
import DebugState from './DebugState.js';
import EnsurePlanCoverage from './EnsurePlanCoverage.js';
import FinalizeArticle from './FinalizeArticle.js';
import FindExternalLinkCandidates from './FindExternalLinkCandidates.js';
import FindInternalLinkCandidates from './FindInternalLinkCandidates.js';
import FetchArticleInputs from './FetchArticleInputs.js';
import GenerateArticlePlan from './GenerateArticlePlan.js';
import GenerateImages from './GenerateImages.js';
import InsertArticle from './InsertArticle.js';
import KeywordResearch from './KeywordResearch.js';
import PickNextContentPlan from './PickNextContentPlan.js';
import PlanArticleImages from './PlanArticleImages.js';
import PlaceImages from './PlaceImages.js';
import RequireName from './RequireName.js';
import RequestInput from './RequestInput.js';
import ScheduleInput from './ScheduleInput.js';
import SelectArticleLinks from './SelectArticleLinks.js';
import Uppercase from './Uppercase.js';
import Wait from './Wait.js';
import WaitForJson from './WaitForJson.js';
import WeaveArticleLinks from './WeaveArticleLinks.js';
import WriteArticle from './WriteArticle.js';

/** Executable block types available to Flow Lab definitions. */
export const flowBlocks: FlowBlockDefinition[] = [
	RequireName,
	BuildGreeting,
	DebugTap,
	Wait,
	Uppercase,
	RequestInput,
	FetchArticleInputs,
	BuildArticleContext,
	KeywordResearch,
	FindInternalLinkCandidates,
	FindExternalLinkCandidates,
	SelectArticleLinks,
	DebugState,
	GenerateArticlePlan,
	PlanArticleImages,
	WriteArticle,
	GenerateImages,
	PlaceImages,
	WeaveArticleLinks,
	FinalizeArticle,
	WaitForJson,
	InsertArticle,
	ScheduleInput,
	EnsurePlanCoverage,
	PickNextContentPlan,
];
