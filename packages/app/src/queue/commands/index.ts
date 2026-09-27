import { defineCommand } from '../../cli';
import makeJob from './makeJob';

export { makeJob };

/** Queue's explicit command index; source generation does not require a running app. */
export const queueCommands = [defineCommand({
	name: 'queue:make-job', description: 'Create an application job under server/jobs.',
	parameters: [{ name: 'name', required: true }], needsApp: false,
	/** Maps the command's named parameter and app root to the source-generation action. */
	handle: (parameters, context) => makeJob({ appDirectory: context.directory, name: parameters.name! }),
	formatResult: result => `Created ${result.path}\nImplement handle(), then register the class in your application bootstrap.`,
})];
