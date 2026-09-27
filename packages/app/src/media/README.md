# @db3.ai/app/media

`@db3.ai/app/media` is the framework-level file and media-browser layer that
sits above `@db3.ai/app/storage`.

Storage owns disks, paths, streams, and bytes. Media owns durable file ULIDs,
library scopes, metadata, and optional browser tree rows.

## Tables

The media package uses three tables:

```text
media_libraries
media_files
media_items
```

`media_libraries` is the ownership and configuration boundary. It stores an
app-owned `scope_type`, `scope_id`, and `library_key`, plus optional storage
defaults such as `default_disk` and `path_prefix`.

`media_files` stores managed file records. A file row can exist without being
visible in a browser.

`media_items` stores browser-visible rows: root folders, directories, and file
placements. A `file` item points to a `media_files` row.

## Scoped Libraries

The framework does not know about application concepts such as websites,
organizations, teams, or users. Apps map those concepts into a scoped library:

```ts
const library = await app.media.libraryFor({
	scopeType: 'app.website',
	scopeId: website.id,
	key: 'default',
	name: 'Website media',
	pathPrefix: `websites/${website.id}/media`,
});
```

The unique library identity is:

```text
scope_type + scope_id + library_key
```

This lets one app start with one default library per scope, while still allowing
future libraries such as `generated-images`, `reference-material`, or
`brand-assets` when they need separate configuration or workflows.

Concurrent first uploads reuse the same scoped library, root and directory
rows when another writer wins creation. Existing defaults and folder metadata
are preserved. Other database errors still propagate to the caller.

## Managed Files Without Browser Items

Use `storeFile()` when a file should be managed, loaded by ULID, and scoped to a
library, but should not appear in the media browser.

```ts
const file = await app.media.storeFile({
	library,
	contents: Buffer.from('private export'),
	name: 'export.txt',
	mimeType: 'text/plain',
	source: 'export',
	meta: {
		jobId: job.id,
	},
});

const bytes = await app.media.readFile(file.id);
```

This creates a `media_files` row only.

## Browser-Visible Files

Use `storeVisibleFile()` when a file should also appear in the browser tree.

```ts
const stored = await app.media.storeVisibleFile({
	library,
	contents: imageBytes,
	name: 'hero-preview.png',
	mimeType: 'image/png',
	source: 'generated-image',
	folderPath: '/Generated images',
	meta: {
		model: 'gpt-image-2',
		prompt,
	},
});

stored.file.id;
stored.item.path;
```

This creates:

- one `media_files` row for the bytes and metadata
- one `media_items` file row for browser placement
- any missing folder rows in the requested folder path

Browser paths are unique within a library. When the requested filename already
exists in the destination folder, media placement keeps the managed file and
its ULID unchanged while numbering the browser item: `moon.png`, `moon-2.png`,
`moon-3.png`, and so on.

## Streaming Completed Uploads

Trusted HTTP adapters can stream an assembled file into managed media without
buffering the complete payload in application memory:

```ts
import { createReadStream } from 'node:fs';

const stored = await app.media.storeVisibleFileStream({
	library,
	stream: createReadStream(temporaryPath),
	size: upload.size,
	name: upload.name,
	mimeType: upload.mimeType,
	source: 'upload',
	folderPath: '/Campaigns',
});
```

Use `storeFileStream()` for a managed file that should not appear in the
browser. Supply a trusted byte size when it is known. When size is omitted,
storage measures the completed object before the `media_files` row is saved.

Untrusted image uploads should instead use canonical reconstruction:

```ts
const stored = await app.media.storeReconstructedVisibleImageStream({
	library,
	stream: createReadStream(temporaryPath),
	name: upload.name,
	mimeType: detectedMimeType,
	source: 'upload',
	folderPath: '/Campaigns',
});
```

The upload adapter should first apply a cheap signature allowlist and require
the detected type to match its declared type. The framework then passes the
complete stream through `ImageProcessor.reconstruct()`. Sharp fully decodes the
input within its pixel and timeout limits, applies orientation, strips metadata
and trailing bytes, and emits a new image in the same canonical format.

The reconstructed stream writes directly to a generated durable path without
buffering the complete source or output in JavaScript memory. The framework
does not save a media row or browser item until the stream completes. Processor
failures remove the partial durable object and raise `ImageReconstructionError`,
allowing an upload adapter to return a validation response rather than a
storage error.

The media package deliberately does not implement an HTTP upload protocol.
Authentication, resumable offsets, temporary-resource expiry, and protocol
responses belong to an app or server adapter above this storage-neutral seam.

## Loading Files

The file ULID is the durable reference. Folder paths can change without
changing the file id.

```ts
const file = await app.media.file(fileId);
const bytes = file ? await app.media.readFile(file) : null;
const stream = file ? await app.media.readFileStream(file) : null;
```

Routes remain responsible for authentication, authorization, headers, and
response shaping. The media package only knows the library scope, not whether a
given user can access that scope.

## Deleting Files

Use `deleteFile()` after the application has applied its own ownership and usage
policy:

```ts
await app.media.deleteFile(file);
```

The manager removes disposable responsive-image variants, deletes the durable
source bytes, and then deletes the `media_files` row. Database foreign keys
remove every browser placement that points at the file. Application references
such as article content remain app-owned and must be checked before calling this
framework method.

## Visibility And Public Delivery

`media_files.visibility` records the storage visibility used when the file was
written. It does not make a file public by itself. Apps should expose public
media through deliberate routes that load the file by ULID, check the source and
visibility they are willing to publish, and then write the response headers.

Generated article images can therefore be stored as browser-visible public
files. Media browsers can render those deliberate public routes directly so
normal browser image caching applies, while private files continue to use an
authenticated app route and browser object URL.

## Responsive Image Variants

The `media/image` module translates an allowlisted URL query into a framework
image command, renders cache misses through an `ImageProcessor`, and stores the
result on a configured disposable storage disk.

```ts
import { imageVariantOptionsFromSearchParams } from '@db3.ai/app/media';

const widthOptions = imageVariantOptionsFromSearchParams(requestUrl.searchParams);
const options = requestUrl.pathname.endsWith('.webp')
	? widthOptions ?? {}
	: widthOptions;

if (options) {
	const image = await app.media.renderImage(file, options);

	reply
		.header('content-type', image.mimeType)
		.send(image.stream);
}
```

The request contract supports width while preserving aspect ratio:

```text
/api/media/images/<media-file-ulid>.webp?w=640
```

To compress an image at its original dimensions, request WebP without a width:

```text
/api/media/images/<media-file-ulid>.webp
```

An article can use that full-size compressed image as its fallback while
letting the browser select a smaller cached width:

```html
<img
	src="/api/media/images/<media-file-ulid>.webp"
	srcset="
		/api/media/images/<media-file-ulid>.webp?w=480 480w,
		/api/media/images/<media-file-ulid>.webp?w=960 960w,
		/api/media/images/<media-file-ulid>.webp?w=1440 1440w
	"
	sizes="(max-width: 48rem) 100vw, 48rem"
	width="1536"
	height="1024"
	loading="lazy"
	decoding="async"
	alt="Useful description of the image"
/>
```

JPEG, PNG, WebP, and AVIF sources produce quality-controlled WebP variants,
apply EXIF orientation, and never enlarge the original. The source URL without
any transform query remains untouched. SVG and GIF files pass through unchanged
because SVG is already responsive and GIF animation must be preserved.

Generated variants are streamed from durable source storage through the
processor and into disposable cache storage without buffering the complete
source or result in JavaScript memory. Cache paths are versioned and keyed by
the immutable managed-file ULID:

```text
image-cache/v1/<file-ulid>/w-640.webp
image-cache/v1/<file-ulid>/original.webp
```

Configure the cache disk and prefix under `config.media`. Omitting `cacheDisk`
keeps the cache on the source disk, while applications with a disposable disk
can isolate every generated variant:

```ts
const media = {
	images: {
		cacheDisk: 'tmp',
		cachePrefix: 'image-cache',
	},
};
```

Deleting the cache directory never removes originals. A later request
regenerates the missing variant using the managed source file.
Failed renders stop both streams and finish pending storage writes before
removing partial cache files and returning the error.

The default `SharpImageProcessor` uses Sharp/libvips. It is isolated behind the
`ImageProcessor` contract so another engine, such as an ImageMagick adapter, can
replace it without changing request parsing, cache identity, media ownership, or
storage.

Safety bounds currently include:

- widths from 1 through 4096 pixels
- a 40-megapixel decoded input limit
- a 20-second processing timeout
- at most two active cache-generating renders per application process
- coalescing concurrent requests for the same variant into one render

Canonical upload reconstruction uses the same 40-megapixel and 20-second
processor bounds. Animated GIF and WebP inputs decode and reconstruct every
frame within the total pixel limit.

Unknown query parameters never become processor commands. Apps remain
responsible for resolving the media ULID and applying authorization before
calling the framework renderer.

## Installation

For an application, add the three models through committed migrations. The
`install` call below is appropriate only for a disposable lab or explicit local
schema setup, not request handling or production server startup.

Install the models alongside your app models:

```ts
import { MediaFile, MediaItem, MediaLibrary } from '@db3.ai/app/media';

await app.db.install(
	MediaLibrary,
	MediaFile,
	MediaItem,
);
```

When using `App`, the media manager is available as:

```ts
await app.media.storeFile(...);
```

## Runnable example and testing

For an authenticated route, copy the Media examples and install `fastify@5`.
Run `npx tsx examples/runPrivateFiles.ts` with the same disposable SQL settings.
It exercises a 64 KiB bounded text upload, owner-scoped streamed download,
private response headers, cross-user rejection, invalid input without writes,
deletion and retry. The exact consumer test is
`tests/examples/runPrivateFiles.test.ts`. Bearer tokens stay inside the lab;
deployment needs HTTPS and the application's session/issuance policy. This is
not a resumable upload, arbitrary-file validator or public publishing endpoint.

The [project media lab](./examples/runProjectMedia.ts) streams a private project
file, creates browser placements, handles duplicate names, scopes a read to the
authorized library and checks byte/placement cleanup on deletion. Copy it into
`examples` and run `npx tsx examples/runProjectMedia.ts` with a dedicated SQL
test account allowed to create/drop `db3_app_test_*` databases.

The lab removes its database and temporary local disk in `finally`. The website
includes the exact consumer-copyable test. Image reconstruction and variant
caching have separate service tests; this text-file workflow does not exercise
them. Framework contributors run
`npm run test:service --workspace packages/app -- media`.
