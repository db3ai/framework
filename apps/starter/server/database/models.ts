import { InAppRecord } from '@db3.ai/app/in-app';
import { QueuedJob, FailedJob } from '@db3.ai/app/queue';
import { ScheduledOccurrence } from '@db3.ai/app/scheduler';
import { AuthProvider, PasswordLoginAttempt, AuthToken, PasswordResetToken, UserIdentity } from '@db3.ai/app/auth';
import { AiConversation, AiMessage, AiRequest, AiRateLimitBucket, AiRateLimitReservation } from '@db3.ai/app/ai';
import { Note } from '../models/Note';
import { CollaborationRoom } from '../models/CollaborationRoom';
import { RoomAccess } from '../models/RoomAccess';

/** Complete model registry used by the app's committed migration workflow. */
export const models = [QueuedJob, FailedJob, ScheduledOccurrence, CollaborationRoom, RoomAccess, InAppRecord, UserIdentity, AuthProvider, PasswordLoginAttempt, AuthToken, PasswordResetToken, Note, AiConversation, AiRateLimitBucket, AiRequest, AiMessage, AiRateLimitReservation];
