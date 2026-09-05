import { AuthProvider, AuthToken, PasswordResetToken, UserIdentity } from '@db3.ai/app/auth';
import { Note } from '../models/Note';

/** Complete model registry used by the app's committed migration workflow. */
export const models = [UserIdentity, AuthProvider, AuthToken, PasswordResetToken, Note];
