# Scheduler

The framework scheduler keeps recurring definitions in application code and
stores one durable occurrence for every due named minute. It supports minute and daily
jobs and short inline calls:

```ts
schedule
	.job(DatabaseBackupJob)
	.dailyAt('02:00')
	.timezone('Europe/London');

schedule
	.job(() => new ReportJob(organizationId))
	.name('weekly-organization-report')
	.dailyAt('06:00');

schedule
	.call(async () => {
		await RecentUser.query().delete();
	})
	.name('clear-recent-users')
	.daily();
```

A `QueueableJob` class uses its durable job name as the schedule name, so
`.name(...)` is optional. Factories and inline calls must provide an explicit
stable name because function identity is not durable. Names must be unique
within one application schedule.

Use `everyMinute()` for bounded background collection, or `daily()` and
`dailyAt('HH:mm')` for daily work. Minute schedules are independent of timezone;
daily times use UTC unless `.timezone(...)` selects an IANA timezone. The worker covers every elapsed UTC minute in order. Applications
can provide durable progress to preserve that coverage across downtime.

## Runtime

`app().scheduler` exposes the scheduler service. Applications register their
definitions once during scheduler and queue-worker bootstrap:

```ts
export function registerSchedule(app: App): void {
	app.scheduler
		.job(DatabaseBackupJob)
		.dailyAt('02:00')
		.timezone('Europe/London');
}
```

There are two execution boundaries:

- `scheduler.runDue()` evaluates one minute and is suitable for cron or a
  one-off framework command.
- `SchedulerWorker` starts with the current minute, then evaluates every minute
  through the current clock time without overlapping ticks in one process.
  All tasks due in a minute retain that original due time, even if dispatching
  them crosses several later minutes. Those later minutes are evaluated next.
  Late or early timers cannot discard minutes. Catch-up yields after sixty
  evaluations to allow shutdown and other work; it does not truncate the backlog.

Run one dedicated scheduler process in production. Multiple processes are
still safe: `scheduled_occurrences` has a unique `(name, scheduled_for)` claim,
so only one process can dispatch a named task for a minute.

Scheduled jobs are the preferred path. The scheduler only creates and
dispatches the job; queue workers perform the expensive work. `call()` runs
inside the scheduler process, so reserve it for short operations.

### Durable worker progress

Register `SchedulerCheckpointRecord` in the application's migration model registry,
then pass `SchedulerCheckpointRecord.checkpoint('my-scheduler')` as `checkpoint`
to `SchedulerWorker` or `runSchedulerConsole`. It persists restart progress in
`scheduler_checkpoints`, with atomic initialization and monotonic updates.
A custom `SchedulerCheckpoint` can supply another backend. Its operations are:

- `load(firstMinute)` atomically establishes the minute immediately before
  `firstMinute` on first use, or returns the existing last evaluated UTC minute.
- `save(evaluatedFor)` durably advances that minute after the complete batch.
  Concurrent writers must never move it backwards.

Coverage is saved before dispatch; replacement workers resume after the cursor.
Occurrence claims deduplicate replay. Without a checkpoint, startup begins in the
current minute. A liveness timestamp cannot establish which minute was evaluated.

An incomplete evaluation or failed checkpoint write retries the same minute
after one second. Individual event failures are recorded as failed occurrences;
they do not prevent the rest of that batch or later minutes from being evaluated.
Catch-up uses currently registered definitions and invokes factories at the time
of dispatch. Business-date-sensitive jobs must define their own date policy.
One-off `scheduler:run`, list and history commands leave the worker cursor alone.

## Occurrence History

`ScheduledOccurrence` owns the `scheduled_occurrences` table. Its lifecycle
states are:

```text
claimed -> queued -> running -> succeeded
                     |       \
                     |        -> retrying -> running
                     \----------> deferred -> running
                     \----------> failed
```

The occurrence records its schedule name, due minute, job name, queue ids,
attempts, error, next-attempt time, and lifecycle timestamps. Queue origin
metadata correlates the job without adding scheduler fields to application job
payloads.

The queue publishes awaited lifecycle events after each driver transition.
Every queue-worker process must initialise `app().scheduler` so its recorder can
update scheduled occurrences when that worker claims or finishes a job.
Listener failures are isolated and logged; they cannot change an already
committed queue outcome.

Terminal occurrences are retained audit records. Replaying a failed scheduled
job with `queue.retryFailed()` creates a new queue identity linked by `retryOf`;
it does not turn the original failed occurrence into a success. Observe the
replacement through queue lifecycle events/results and the application output.
Queue does not persist a general success-history table. If an operations screen
needs a durable recovered outcome, store the replacement identity and outcome
on an application-owned report record. Do not erase the original failure.

The shipped [replay runner](./examples/runScheduledReplay.ts) and
[repairable job](./examples/RecoverableSummaryJob.ts) demonstrate this boundary:
`npx tsx examples/runScheduledReplay.ts` fails on a missing local source, adds
the source and successfully replays, while preserving the failed occurrence
and rejecting a duplicate claim for the same minute. The copied Scheduler test
asserts both the recovered output and the retained audit state.

## Console

Applications can expose the framework console with `runSchedulerConsole(...)`:

```text
scheduler:work
scheduler:run
scheduler:list
scheduler:history --limit=25 --status=failed
```

`scheduler:work` is the long-running process. `scheduler:run` provides the same
single-minute boundary that cron can invoke. `scheduler:list` validates and
prints code-owned definitions. `scheduler:history` inspects durable occurrence
state.

## Runnable example and testing

The shipped [daily summary job](./examples/WriteDailySummaryJob.ts),
[registration function](./examples/registerDailySummary.ts) and
[isolated runner](./examples/runDailySummary.ts) demonstrate a real SQL queue.
Copy the example directory into an independent app's `examples` directory and
run `npx tsx examples/runDailySummary.ts` with dedicated test SQL credentials.
It creates/removes a `db3_app_test_*` database and temporary local storage.

The runner evaluates a fixed UTC minute, rejects a second claim for that minute,
processes the job and verifies successful occurrence history. It never sleeps
or runs an application's historical schedules. The website includes the exact
consumer-copyable test. Framework contributors run
`npm run test:service --workspace packages/app -- scheduler`.

The [elapsed-window runner](./examples/runSchedulerWindow.ts) demonstrates a
boundary crossed during a heartbeat and a slow batch spanning the next minute,
using the real SQL queue and a controlled clock. Run
`npx tsx examples/runSchedulerWindow.ts` with the same dedicated test credentials.

A daily local time may not occur during a spring DST transition and may map to
two UTC minutes during an autumn transition. Claims are keyed by UTC minute,
not by a local business date. A nonexistent DST wall-clock minute is not a
missed UTC evaluation. There is no exactly-once side-effect guarantee.
Claims and queue dispatch are separate operations; monitor and
reconcile occurrences left claimed by an interrupted dispatch.

`SchedulerWorkerOptions.onTick` (also accepted by the scheduler console) lets
an application persist a successful tick heartbeat, with `result.evaluatedFor`
identifying the covered minute. It runs only when `runDue` returns without
failures. Hook failures are logged and cause the same minute to be reconsidered.
An independent monitor must detect stale heartbeats; scheduler self-logging
cannot detect a scheduler process that has stopped.
