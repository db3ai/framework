# Scheduler

The framework scheduler keeps recurring definitions in application code and
stores one durable occurrence for every due named minute. It supports daily
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

The first implementation intentionally supports only `daily()` and
`dailyAt('HH:mm')`. Times use UTC unless `.timezone(...)` selects an IANA
timezone. The scheduler evaluates the current minute only; it does not run
missed historical minutes after downtime.

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
- `SchedulerWorker` evaluates immediately, waits to the next minute boundary,
  and repeats without overlapping ticks in the same process.

Run one dedicated scheduler process in production. Multiple processes are
still safe: `scheduled_occurrences` has a unique `(name, scheduled_for)` claim,
so only one process can dispatch a named task for a minute.

Scheduled jobs are the preferred path. The scheduler only creates and
dispatches the job; queue workers perform the expensive work. `call()` runs
inside the scheduler process, so reserve it for short operations.

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

A daily local time may not occur during a spring DST transition and may map to
two UTC minutes during an autumn transition. Claims are keyed by UTC minute,
not by a local business date. There is no catch-up or exactly-once side-effect
guarantee. Claims and queue dispatch are separate operations; monitor and
reconcile occurrences left claimed by an interrupted dispatch.
