import { kanbanTutorial } from './kanban';
import { presenceTutorial } from './presence';
import { actionsTutorial } from './actions';
import { jobsTutorial } from './jobs';
import { chatTutorial } from './chat';
import { deploymentsTutorial } from './deployments';
import { yjsTutorial } from './yjs';
import { aiTutorial } from './ai';
import { approvalsTutorial } from './approvals';
import { uploadsTutorial } from './uploads';
import { inventoryTutorial } from './inventory';
import { permissionsTutorial } from './permissions';

/** Registered, independently linkable realtime tutorials. */
export const realtimeTutorials = [kanbanTutorial, presenceTutorial, actionsTutorial, jobsTutorial, chatTutorial, deploymentsTutorial, yjsTutorial, aiTutorial, approvalsTutorial, uploadsTutorial, inventoryTutorial, permissionsTutorial];
