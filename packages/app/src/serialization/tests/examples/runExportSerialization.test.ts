import { expect, it } from 'vitest';
import { Serializer } from '@db3.ai/app/serialization';
import { ExportRequest } from '../../examples/ExportRequest';
import { runExportSerialization } from '../../examples/runExportSerialization';

it('restores private state through a JSON boundary and recovers missing worker registration', async () => {
	expect(await runExportSerialization()).toEqual({ label: 'ada:25', privateStateRestored: true, format: 'platform.serialized-object', wireVersion: 1, unknownRejected: true, invalidStateRejected: true, repaired: 'ada:25' });
});

it('validates constructor state and rejects incompatible envelope versions', async () => {
	expect(() => new ExportRequest({ version: 1, ownerId: ' ', limit: 25 })).toThrow();
	const serializer = new Serializer({ classes: { 'notes.export.v1': ExportRequest } });
	const payload = serializer.serialize(new ExportRequest({ version: 1, ownerId: 'ada', limit: 1 }));
	await expect(serializer.deserialize({ ...payload, version: 99 })).rejects.toThrow();
	expect((await serializer.deserialize<ExportRequest>(payload)).label()).toBe('ada:1');
});
