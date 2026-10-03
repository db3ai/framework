# Events

`@db3.ai/app/events` provides the typed, in-process event dispatcher exposed
through `app().events`. It is intended for application events and small
cross-cutting reactions without coupling the producer to each listener.

## Run a note event

Complete [Installation](https://db3.ai/framework/docs/installation), then run this from your independent application:

```sh
mkdir -p examples
cp -R node_modules/@db3.ai/app/src/events/examples/. examples/
npx tsx examples/runNoteEvents.ts
```

Expect the trace `index:one`, `first:one`, `index:two`, `after:four`, with `rejected: true` and `hasListeners: false`. The third dispatch fails before its later listener. The example removes the failing listener and dispatches a new event. It has no database, side-effecting indexer or durable worker.

Copy the exact test from [Events](https://db3.ai/framework/docs/events#testing) into `tests/events/runNoteEvents.test.ts` and run:

```sh
npx vitest run tests/events/runNoteEvents.test.ts
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --types node --skipLibCheck examples/*.ts
```

The tests use the real dispatcher and cover every service method, exact-class identity, async ordering, failure propagation and cleanup. See the [complete contract reference](https://db3.ai/framework/docs/events-api) for listener and constructor types.

## Defining And Dispatching Events

Events are normal classes containing application data. Prefer past-tense names
that describe something that has already happened:

```ts
class WebsiteCrawled {
	constructor(
		readonly websiteId: string,
		readonly crawlId: string,
	) {}
}
```

Register listeners during application boot, then dispatch an instance:

```ts
const unsubscribe = app().events.listen(WebsiteCrawled, async event => {
	await updateSearchIndex(event.websiteId);
});

await app().events.dispatch(new WebsiteCrawled(websiteId, crawlId));

unsubscribe();
```

The event class is the runtime listener key and gives the callback its inferred
event type. Listeners registered for a parent class do not receive subclass
instances.

Use `once(...)` for a one-shot listener:

```ts
app().events.once(WebsiteCrawled, event => {
	app().log.info({
		websiteId: event.websiteId,
	}, 'Observed the first completed crawl');
});
```

`hasListeners(EventClass)`, `forget(EventClass)`, and `clear()` are available
for bootstrapping, tests, and explicit teardown. `App.close()` automatically
clears listeners created through `app().events`.

## Execution And Errors

`dispatch(...)` invokes the listeners present when dispatch begins, in
registration order. It awaits each asynchronous listener before starting the
next listener.

If a listener throws or rejects, dispatch rejects and later listeners are not
run. This makes failure visible to the producer and avoids silently losing
required application work. Catch the error at the producer only when that
failure is intentionally non-fatal.

Earlier listeners may already have made changes; there is no rollback. Do not replay a whole dispatch without considering duplicate side effects. The listener list is captured when dispatch begins, so unsubscribing does not cancel callbacks already in that snapshot.

Event data is not cloned. Every listener receives the same instance, so event
classes should normally be immutable data objects.

## Process And Durability Boundary

Framework events are process-local and in-memory:

- They are not persisted.
- They do not cross API, queue-worker, or scheduler processes.
- They are lost if the process exits before dispatch completes.
- They do not retry failed listeners.

Use the queue for durable, retryable, delayed, or cross-process work. A simple
event listener can dispatch a queued job when an event should trigger that kind
of work.

A database commit followed by event dispatch is not an atomic outbox. Design a transaction/reconciliation boundary explicitly when a durable handoff cannot be lost.

Queue lifecycle events remain a separate typed stream because they describe
queue-driver transitions and intentionally isolate observer failures from
already-completed queue operations. Logs also remain observability records;
they must not be used to trigger application behavior.
