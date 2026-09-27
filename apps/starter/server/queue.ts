import { runQueueConsole } from '@db3.ai/app/queue';
import { createApplication } from './app';
import { readConfig } from './config';

const application = createApplication(readConfig());
await runQueueConsole({ app: () => application, bootstrap: () => application.apps.boot() });
