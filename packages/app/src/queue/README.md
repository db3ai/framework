# Queue

The framework's `db3 queue:make-job NameJob` command is registered in
`queue/commands/index.ts`; its `makeJob.ts` action calls `createJob()`.
Command parsing, help and process
lifecycle are shared by the [framework CLI](../cli/README.md).

The installed-package chain/batch lab is
[runQueueWorkflows.ts](./examples/runQueueWorkflows.ts). Copy the shipped Queue
examples and run `npx tsx examples/runQueueWorkflows.ts` with dedicated SQL test
credentials. It rejects an empty pipeline, processes one chain successor at a
time and two independent batch jobs, then destroys its generated database.
`GenerateReportJob` only logs an identity; use the queued-report guide for a job
that reads and writes real report files. This lab does not prove atomic chain
handoff or exactly-once side effects.

## Provider backpressure lab

The shipped `examples/runBackpressure.ts` uses a real SQL queue and a controlled
provider readiness flag. It defers twice without spending a try, succeeds after
readiness changes and terminates expired work using an application deadline.
The companion `tests/examples/runBackpressure.test.ts` is consumer-copyable.
The zero-second delay is only for deterministic testing; production adapters
must validate provider delays and apply their own deadline/idempotency policy.

Move work out of a request without losing it when that process exits. Queue
persists JSON-safe payloads, restores a fresh job for each attempt and records
success, retry, deferral or terminal failure.

Import application APIs from `@db3.ai/app/queue`. Keep the job and its business
policy in your app. Queue owns dispatch, leases and retry transitions; Storage
owns bytes; your application owns authorization, progress and idempotency.

## Run a real report

Start with Node.js 24 and an independent ESM app from
[Installation](https://db3.ai/docs/installation). Before npm publication, install
matching App and Pure tarballs supplied by a maintainer. Add `tsx`,
`typescript`, `@types/node` and `vitest` as development dependencies.

The report lab needs local MariaDB and a dedicated test account that may create
and drop only `db3_app_test_*` databases. Do not use production credentials.
Save test-only settings in the app-root `.env`, exclude it from Git, and unset
`DATABASE_URL` unless it intentionally points at this test server:

```dotenv
DB_CONNECTION=mariadb
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=your_test_user
DB_PASSWORD=your_test_password
DB_DATABASE=db3_app_test
DB_TEST_DATABASE_PREFIX=db3_app_test
```

Copy the shipped examples into your app and run:

```sh
mkdir -p examples
cp -R node_modules/@db3.ai/app/src/queue/examples/. examples/
npx tsx examples/runQueueReports.ts
```

The lab creates an isolated database and local temporary directory. It removes
both in `finally`; killing the process forcibly can leave temporary resources.
It does not touch the starter's notes database or call an AI/email provider.

Read these actual example sources:

- [WriteReportJob.ts](./examples/WriteReportJob.ts): validate a stable revision
	identifier and replace its output instead of appending duplicate content.
- [runQueueReports.ts](./examples/runQueueReports.ts): close the producer, restore
	SQL-backed work in a fresh App, repair a missing source and replay a failure.
- [queue-reports.json](./examples/outputs/queue-reports.json): asserted output.
- [reportConsole.ts](./examples/reportConsole.ts): application-owned CLI adapter.

Expected result:

```json
{
	"wrongQueueIdle": true,
	"firstAttempt": "released",
	"finalAttempt": "failed",
	"replayLinked": true,
	"repeated": "succeeded",
	"text": "Report: Three notes ready\n",
	"reportFiles": 1,
	"remainingJobs": 0,
	"retainedFailures": 1
}
```

The missing source deliberately fails twice. The lab fixes the cause, replays
the failed record and drains a polling worker. The original failure remains for
audit. Another dispatch replaces the same report, leaving one output.
Zero-second backoff is used only to keep the test deterministic.

## Run it in the starter

The disposable lab uses `Database.install()`. Your app must use migrations.

In the Notes + AI starter, add `QueuedJob` and `FailedJob` from
`@db3.ai/app/queue` to the existing `models` array in
`server/database/models.ts`, retaining every current model:

```sh
npm run db:make:migration -- add_queue_tables
# Review the generated migration before applying it.
npm run db:migrate
npm run db:check
```

Now use your development app's database settings, not the test-only lab
configuration. The copied console adapter loads `.env`, registers
`WriteReportJob` and uses the database driver. Its local storage root is
`data/queue-reports`, or the absolute `REPORT_STORAGE_ROOT` you supply.
Exclude `data/` from Git. Producer and worker must share that storage.

```sh
npx tsx examples/reportConsole.ts report:seed
npx tsx examples/reportConsole.ts queue:dispatch reports.write.v1 '{"reportId":"weekly-v1"}' --queue=reports --tries=2
npx tsx examples/reportConsole.ts queue:work --queue=reports --once
npx tsx examples/reportConsole.ts queue:failed
```

Expect a dispatch ID, a successful processing line, and
`data/queue-reports/reports/weekly-v1.txt` containing
`Report: Three notes ready`. `report:seed` and `queue:failed` are example-owned
commands. They write fixed sample input and list safe, bounded failure metadata.

For a continuous worker, use a separate terminal:

```sh
npx tsx examples/reportConsole.ts queue:work --queue=reports --max-jobs=1
```

Ctrl-C drains the active tick before closing the App. To replay a repaired
terminal failure, use its failed-record ID, not its original active-job ID:

```sh
npx tsx examples/reportConsole.ts queue:retry 123 --queue=reports
```

Replace `123` with a real ID from `queue:failed`. Repeated replay calls each
create another job; replay is not deduplicated. In your own app, reuse the same
bootstrap/configuration for the HTTP process and worker without starting an HTTP
listener in the worker. These are adapter command names, not global executables.

## Design the payload

Extend `QueueableJob`, validate constructor data and implement `handle()`.
The inherited `toJSON()` and `fromJSON()` cover normal JSON data. Set an explicit
stable `jobName`, such as `reports.write.v1`; class names otherwise become
durable names. Keep old names/payload versions supported while stored work can
still reference them.

Store immutable identities or versioned inputs, not open connections, request
objects, API keys or large file bodies. Load current application data in the
handler and recheck permission/state if access can be revoked after dispatch.

Dispatching a constructed job auto-registers its class in that process only.
Every separate worker must call `registerJob()` for all reachable jobs or supply
a `jobResolver`. `registerHandler()` is available for a stable named function
handler; it does not supply class constructor validation automatically.

## Queue names, timing and capacity

A `reports` worker only claims `reports` jobs. `delaySeconds` sets earliest
availability, not a guaranteed execution time. `workNextJob()` processes at most
one available job and returns `null` when idle. Its statuses are `succeeded`,
`released`, `deferred`, `failed` and `lease_lost`.
`processNextJob()` returns whether any job was processed, not whether it succeeded.

`startWorker()` starts a polling loop. `workerEnabled: false` or
`QUEUE_WORKER=false` disables it unless forced. `maxJobsPerTick` bounds sequential
work per tick; it is not concurrency. Use more supervised worker processes for
parallelism. Polling defaults to 1000 ms and valid intervals are clamped to at
least 100 ms. `queue:work --once` checks once and exits, even if delayed work exists.

## Retries and repair

Ordinary errors consume attempts. Dispatch defaults are three attempts,
exponential backoff starting at 15 seconds, capped at 3600 seconds, with jitter
off unless changed in queue options/environment. The supported strategies are
`linear` and `exponential`. For constant delay set `initialSeconds` and
`maxSeconds` equal; there is no `fixed` strategy.

[manageReportRetries.ts](./examples/manageReportRetries.ts) shows bounded backoff,
provider backpressure and replay. `retryUntilSeconds` bounds scheduling another
ordinary retry; it is not an execution deadline and does not abort a running job.
Throw `QueueRetryLaterError` only for deliberate backpressure. It restores the
attempt and bypasses the ordinary retry window, so the app must own a separate
deadline to prevent immortal work.

`failedJobs(limit)` reads recent failures. `retryFailed(id, options)` creates a
new UUID linked by `payload.retryOf` and preserves the old failure. Repair the
cause and check that the operation is still authorized before replaying. The
replacement receives a fresh retry policy/window; the original deadline is not
a continuing replay cutoff.

`onRetry()` runs after release, `onFinalFailure()` after persisted failure.
Deliberate deferrals call neither. Hook/listener errors go to
`onLifecycleError` and cannot reverse the transition. Use durable application
state for important recovery, not a hook that must never fail.

## Leases are not exactly-once execution

Database and Redis drivers renew reservations during execution, approximately
every third of `retryAfterSeconds` (at least one second). They check ownership
again before the outcome transition. Mutations are fenced by job ID and attempt.

A crash, blocked event loop or lost connection can let another worker claim
the job after expiry. `lease_lost` means this worker cannot safely commit the
queue outcome; the handler may already have performed external work.
`retryAfterSeconds` is a lease duration, not a timeout or cancellation API.

Make side effects idempotent. The report example replaces one stable output for
immutable input, but that is not an atomic file/database transaction. Email and
payments need application/provider idempotency. Avoid a non-transactional
"already done" read followed by an unprotected write.

## Chains and batches

[dispatchReportWorkflows.ts](./examples/dispatchReportWorkflows.ts) demonstrates
`chain()` for ordered work and `batch()` for independent jobs. Register every
job that can appear in a chain, not just its first class.

A chain persists the first job with its remaining steps. Success dispatches the
next step before deleting the predecessor. Those transitions are not atomic: a
crash between them can duplicate the successor. Every step still needs
idempotency and important workflows need reconciliation.

Successors inherit queue, maximum attempts and backoff. They do not inherit the
root's origin, initial delay or ordinary retry deadline. A terminal failure
stops advancement. Replaying its stored failure can resume the remaining chain.

A batch dispatches sequentially and returns IDs; it is not an all-or-nothing
transaction or a tracked batch record. Earlier dispatches remain if a later one
fails. There are no built-in batch counters, cancellation or completion callbacks.

## Transactions and dispatch

The default `app().queue` does not join a surrounding ActiveRecord transaction.
Do not enqueue before commit and assume rollback removes the job or workers
cannot see it. Commit, then dispatch for the simple case.

That still leaves a crash window between commit and dispatch. For work that
must not be missed, write an application outbox in the same transaction and
publish it with idempotency and reconciliation. No built-in `afterCommit()` or
transactional outbox contract exists yet.

## Drivers and shutdown

The database driver needs migrated `QueuedJob` and `FailedJob` tables.
Redis stores jobs, ready/delayed/reserved state and failures under a configurable
prefix. Choosing Redis does not migrate queued SQL work.

For Redis, configure a dedicated app/environment prefix and an appropriate
persistence, eviction and authentication/TLS policy. A prefix is not access
control. Retain the concrete driver you inject:

```ts
import { RedisQueueDriver } from '@db3.ai/app/queue';
import { App } from '@db3.ai/app/server';

const driver = new RedisQueueDriver({
	url: process.env.QUEUE_REDIS_URL,
	keyPrefix: 'my-app:development:queue',
});
const application = new App({ queue: { driver, queue: 'reports' } });
```

Stop and drain workers first, then `await driver.close()`, then
`await application.close()`. `App.close()` does not stop Queue workers or close
the Redis Queue driver. Adapt a Redis console host's `close()` callback to close
both resources after worker drain.

`stop()` stops future polling; `stopAndDrain()` waits for the current tick,
which can include several jobs. Neither aborts a handler. Give supervisors enough
shutdown grace time and restart workers after code changes.

## Progress, monitoring and privacy

Use `queue.events.subscribe()` for lifecycle observations; it returns an
unsubscribe function. Listeners are awaited after transitions. Slow listeners
delay the worker; exceptions cannot undo already committed state.

Successful jobs leave active storage. Keep user-visible progress/output
identities on application models. `QueueMonitor` is development telemetry, not
durable history or an accounting ledger. Monitor backlog age, retries, terminal
failures and ambiguous lease losses.

Payloads, lifecycle events and stored exceptions can expose sensitive values.
Never queue secrets; redact before exporting telemetry, restrict access to
inspection/replay and define retention. There is no automatic failure pruning.

## Troubleshooting

- Idle worker: check the exact queue name, availability time and reservation.
- Missing handler: fix registration/deployed job name, then inspect and replay.
- Missing SQL table: apply queue migrations against this process's database.
- Missing file: ensure workers share the same storage and immutable source.
- Hanging shutdown: drain the active tick and close any owned Redis driver.
- `failed` status with exit code zero: finite console commands report outcomes
	in logs; shell success does not guarantee job success.
- Infrastructure failure: `workNextJob()` can reject before returning a result.
	Do not turn an unavailable database into a silent empty queue.

## Test the workflow

The [Queue guide](https://db3.ai/docs/queue-overview#testing) renders the exact
service-owned test. Save it as `tests/queue/runQueueReports.test.ts`, retaining
the example and `outputs/` directory above:

```sh
npx vitest run tests/queue/runQueueReports.test.ts --maxWorkers=1
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --types node --resolveJsonModule --skipLibCheck examples/*.ts
```

It uses real SQL, files and Queue, covering failure/repair/replay, App lifetime,
worker drain, repeated output and invalid identities. Tests fail when SQL is
unavailable rather than skipping this documented path.

For source-repository maintenance:

```sh
npm run test:service --workspace packages/app -- queue --maxWorkers=1
npm run check --workspace packages/app
npm run framework:package:test
```

Older deterministic-driver tests execute the small chain/batch/backpressure
examples. Built-in-driver suites separately exercise SQL/Redis leases and
transitions. Redis tests may skip locally when unavailable; release verification
must set `TEST_REDIS_REQUIRED=1` and supply real infrastructure. A passed SQL
report lab is not proof of Redis operational readiness.

## Reference, coverage and follow-up

The [Queue API reference](https://db3.ai/docs/queue-api) renders freshly emitted
service, job, payload, retry, worker, driver, Redis and console contracts.
Use `@db3.ai/app/queue` imports, not internal declaration paths.

Taught and executed here: SQL persistence, registration, named queues, retries,
terminal history, repair/replay, worker drain, repeatable output and input
validation. Explained with separate tests/reference: leases, Redis, lifecycle
observers, hooks, chains, batches and console adapters.

Not implemented: hard job timeout/cancellation, built-in unique jobs, atomic
chain handoff, first-class tracked batches, retry-all, automatic pruning or a
transactional outbox. Follow-up walkthroughs: shared-storage deployment,
provider-backed AI budgets, idempotent email, and failure-retention operations.

Queue owns its contracts, drivers, examples and tests. It depends on Database,
Logging and App composition; Scheduler and Flows consume its lifecycle.


## Create a job in your app

Run `npx db3 queue:make-job GenerateReportJob` from the app root. It creates
`server/jobs/GenerateReportJob.ts` and refuses to overwrite an existing file.
Replace the template payload and implement `handle()`, then register the job in
the shared application bootstrap before dispatching it. The unimplemented
handler throws so a generated skeleton cannot silently consume real work.

Editor or Studio integrations can use `jobTemplate(name)` to preview the same
source and `createJob({ appDirectory, name })` to create the file. These are
shared framework operations; a Studio screen is not included in this package.

## Atomic application dispatch

The database driver's `push` participates in an explicit `ActiveRecord.withDb`
scope, including one established by `app().db.transaction`. Application records
and queued jobs can therefore commit or roll back together. Outside a scope it
uses its configured database. Redis dispatch is not transactional with SQL.
Dispatch lifecycle events may run before the surrounding transaction commits;
observers must not perform irreversible external work on those events.
