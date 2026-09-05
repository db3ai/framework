# @db3.ai/app/storage

## Stream failure and recovery lab

Copy `src/storage/examples/` from the installed package into `examples/` and run
`npx tsx examples/runStreamExport.ts`. The lab streams 50,000 rows, interrupts a
staged write, preserves the last successful export and removes partial bytes.
It needs only temporary local storage and removes that directory afterwards.
`tests/examples/runStreamExport.test.ts` is the consumer-copyable behavioral
check. Remote moves and HTTP disconnects need separate adapter/driver tests.

`@db3.ai/app/storage` provides a Laravel-style storage service with named
disks. App code can write to the default disk through `app.storage` or select a
configured disk with `app.storage.disk(name)`.

The storage service is the lower-level file API. Managed file records, ULID
references, and database-backed file metadata should sit above this layer.

## Configure disks

```ts
import { App } from '@db3.ai/app';

const app = new App({
	storage: {
		default: 'local',
		disks: {
			local: {
				driver: 'local',
				root: 'storage/app',
			},
			agent: {
				driver: 'local',
				root: 'storage/agent',
				url: 'https://example.test/storage/agent',
			},
			spaces: {
				driver: 's3',
				bucket: 'example-assets',
				region: 'nyc3',
				endpoint: 'https://nyc3.digitaloceanspaces.com',
				url: 'https://example-assets.nyc3.digitaloceanspaces.com',
				accessKeyId: process.env.SPACES_ACCESS_KEY_ID,
				secretAccessKey: process.env.SPACES_SECRET_ACCESS_KEY,
			},
		},
	},
});
```

If no storage config is supplied, `local` is available and writes under
`storage/app` relative to the process working directory. The local driver is
backed by Flystorage's `FileStorage` and `LocalStorageAdapter`.

## Day-To-Day Usage

Most app code should use the default disk unless it has a good reason to choose
a specific backend. `write(...)` and `put(...)` do the same thing. `put(...)`
matches Laravel naming, while `write(...)` is convenient in the REPL.

### Write A Text File

```ts
await app().storage.write('my/test-file.txt', 'hello i am a test file');
```

Or, using the Laravel-style name:

```ts
await app().storage.put('my/test-file.txt', 'hello i am a test file');
```

### Read A Text File

```ts
const text = await app().storage.readToString('my/test-file.txt');
```

`getText(...)` is also available when you want to pass a Node text encoding.

### Read A Stream

`read(...)` follows Flystorage's API and returns a readable stream:

```ts
const stream = await app().storage.read('my/test-file.txt');
```

Use `get(...)` when you intentionally want the whole file buffered:

```ts
const buffer = await app().storage.readToBuffer('my/test-file.txt');
const bytes = await app().storage.readToUint8Array('my/test-file.txt');
```

`get(...)` is also available as a shorter alias for `readToBuffer(...)`.

### Write JSON

```ts
await app().storage.write('reports/latest.json', JSON.stringify({
	status: 'ready',
}, null, '\t'), {
	mimeType: 'application/json',
});
```

### Write Bytes

```ts
await app().storage.write('images/avatar.png', imageBytes, {
	mimeType: 'image/png',
	visibility: 'private',
});
```

### Check, Delete, And Inspect Files

```ts
await app().storage.exists('my/test-file.txt');
await app().storage.missing('my/missing-file.txt');
await app().storage.size('my/test-file.txt');
await app().storage.lastModified('my/test-file.txt');
await app().storage.mimeType('images/avatar.png');
await app().storage.delete('my/test-file.txt');
```

### List Directory Contents

`list(...)` returns a lazy, provider-neutral async listing for local and remote
disks. Set `deep` when descendants below the immediate directory are needed:

```ts
const listing = app().storage.disk('local').list('reports', {
	deep: true,
});

for await (const entry of listing) {
	console.log(entry.type, entry.path, entry.lastModified);
}
```

Collect a listing when the complete result is intentionally needed in memory:

```ts
const entries = await app().storage.disk('local').list('reports', {
	deep: true,
}).toArray();
```

Pass an empty path or omit it to list from the disk root. Listings expose the
same framework entry shape for every driver; callers do not need to know whether
the selected disk is local or S3-compatible.

For local disks, `path(...)` returns the absolute filesystem path:

```ts
app().storage.path('my/test-file.txt');
```

Remote disks such as S3 do not expose local paths, so use `url(...)` when a
public URL is configured:

```ts
await app().storage.url('images/avatar.png');
```

### Use A Named Disk

```ts
await app().storage.disk('agent').write('generated-images/example.txt', 'hello agent disk');

const text = await app().storage.disk('agent').getText('generated-images/example.txt');
```

`drive(name)` is also available as an alias for `disk(name)`:

```ts
await app().storage.drive('agent').write('notes/example.txt', 'stored on the agent disk');
```

## Try It In Tinker

From the repo root, start the CLI REPL:

```sh
npm run tinker
```

An application tinker context can expose both `app` and `app()` styles. Top-level
`await` is supported, so each command waits for the storage operation to finish
before the prompt returns:

```ts
await app().storage.write('my/test-file.txt', 'hello i am a test file')
await app().storage.read('my/test-file.txt')
await app().storage.readToString('my/test-file.txt')
await app().storage.readToBuffer('my/test-file.txt')
await app().storage.readToUint8Array('my/test-file.txt')
await app().storage.exists('my/test-file.txt')
await app().storage.delete('my/test-file.txt')
```

If you prefer property access, this works too:

```ts
await app.storage.write('my/test-file.txt', 'hello from app.storage')
```

## Use The Default Disk

```ts
await app.storage.put('reports/latest.json', JSON.stringify({
	status: 'ready',
}));

const text = await app.storage.getText('reports/latest.json');
```

## Use A Named Disk

```ts
const agent = app.storage.disk('agent');

await agent.write('generated-images/example.png', imageBytes, {
	mimeType: 'image/png',
	visibility: 'private',
});

const bytes = await agent.get('generated-images/example.png');
```

## Stream Large Files

Use explicit stream methods when files should not be buffered into memory:

```ts
await app.storage.disk('agent').writeStream('uploads/source-video.mp4', requestStream, {
	mimeType: 'video/mp4',
});

const stream = await app.storage.disk('agent').readStream('uploads/source-video.mp4');
```

`read(...)` is also available and matches Flystorage's stream-returning method:

```ts
const stream = await app.storage.disk('agent').read('uploads/source-video.mp4');
```

These methods are backed by Flystorage streams, so they are the preferred API
for large uploads, exports, and future remote disks such as S3. The framework
wrapper passes stream objects through to the driver and does not buffer them
before writing or reading.

## S3-Compatible Disks

Use `driver: 's3'` for AWS S3 and services that support the S3 protocol:

```ts
const storage = new Storage({
	default: 'spaces',
	disks: {
		spaces: {
			driver: 's3',
			bucket: 'example-assets',
			region: 'nyc3',
			endpoint: 'https://nyc3.digitaloceanspaces.com',
			url: 'https://example-assets.nyc3.digitaloceanspaces.com',
			accessKeyId: env.required('SPACES_ACCESS_KEY_ID'),
			secretAccessKey: env.required('SPACES_SECRET_ACCESS_KEY'),
		},
	},
});
```

`endpoint` is optional for AWS S3 and useful for providers such as DigitalOcean
Spaces, MinIO, and other S3-compatible services. Use `forcePathStyle: true`
when the provider expects path-style bucket URLs.

## Path safety

Storage paths are always relative to the disk root. Absolute paths, null bytes,
and parent-directory traversal are rejected before the driver touches the
filesystem. File operations reject empty paths; `list('')` deliberately allows
an empty path to list the disk root.

## Runnable example and testing

The [storage lab](./examples/runStorage.ts) writes and reads JSON and a streamed
CSV, lists the resulting paths, checks traversal rejection and deletes a file.
It uses a real temporary local disk, removes that directory afterwards and does
not need SQL or cloud credentials. Copy the shipped example into `examples`
and run `npx tsx examples/runStorage.ts` in the consuming app.

The Storage website page includes the exact Vitest test for that copied file.
Framework contributors run `npm run test:service --workspace packages/app -- storage`.
Local behaviour is not evidence that an S3 account, bucket policy or interrupted
upload works correctly. Verify those against dedicated provider test resources.

## Local disk URLs

The local driver can build URLs only when `url` is configured:

```ts
const url = await app.storage.disk('agent').url('generated-images/example.png');
```

This method only returns the URL. Routes remain responsible for authentication,
ownership checks, headers, and response shaping.
