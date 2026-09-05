import { pathToFileURL } from 'node:url';
import { SerializationError, Serializer } from '@db3.ai/app/serialization';
import { App } from '@db3.ai/app/server';
import { ExportRequest } from './ExportRequest';

/** Exercises the JSON boundary, unknown registration, invalid state and recovery. */
export async function runExportSerialization() {
	const application = new App({ serializer: { classes: { 'notes.export.v1': ExportRequest } } });
	try {
		const payload = application.serializer.serialize(new ExportRequest({ version: 1, ownerId: 'ada', limit: 25 }));
		const durable = JSON.parse(JSON.stringify(payload));
		const restored = await application.serializer.deserialize<ExportRequest>(durable);
		const worker = new Serializer();
		let unknownRejected = false;
		try { await worker.deserialize(durable); } catch (error) { if (!(error instanceof SerializationError)) throw error; unknownRejected = true; }
		worker.registry.registerClass('notes.export.v1', ExportRequest);
		let invalidStateRejected = false;
		try { await worker.deserialize({ ...durable, state: { ...durable.state, limit: 0 } }); } catch (error) { if (!(error instanceof SerializationError)) throw error; invalidStateRejected = true; }
		const repaired = await worker.deserialize<ExportRequest>(durable);
		return { label: restored.label(), privateStateRestored: restored instanceof ExportRequest, format: payload.format, wireVersion: payload.version, unknownRejected, invalidStateRejected, repaired: repaired.label() };
	} finally { await application.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runExportSerialization(), null, 2));
