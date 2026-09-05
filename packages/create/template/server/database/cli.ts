import { createApplication } from '../app';
import { readConfig } from '../config';
import { migrations } from './migrations';

const application = createApplication(readConfig());
try {
	const manager = migrations(application);
	const command = process.argv[2];
	if (command === 'migrate') console.log(await manager.migrate());
	else if (command === 'check') {
		const result = await manager.check();
		console.log(result);
		if (!result.matches) process.exitCode = 1;
	} else if (command === 'make') {
		const result = await manager.makeMigration({ name: process.argv[3] });
		console.log(result);
		if (result.blocked) process.exitCode = 1;
	} else throw new Error('Use migrate, check or make.');
} finally {
	await application.close();
}
