import { runSchedulerConsole } from '@db3.ai/app/scheduler';
import { createApplication } from './app';
import { readConfig } from './config';

const application = createApplication(readConfig());
await runSchedulerConsole({ app: () => application, bootstrap: () => application.apps.boot() });
