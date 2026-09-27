import { writeAppTypes } from '@db3.ai/app/apps';
import { fileURLToPath } from 'node:url';

await writeAppTypes(fileURLToPath(new URL('../', import.meta.url)));
