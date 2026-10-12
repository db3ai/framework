import type { Knex } from 'knex';

/** Weakly tracks the existing transaction lifecycle without retaining completed connections. */
const commits = new WeakMap<Knex.Transaction, Promise<boolean>>();

/**
 * Observes commit of every enclosing transaction/savepoint without blocking its caller.
 * Returns undefined outside a transaction; false includes silent or rejected rollbacks.
 * Delivery callbacks must re-enter the application's ordinary database scope after resolution.
 */
export function databaseTransactionCommit(connection: Knex): Promise<boolean> | undefined {
	if (!connection.isTransaction) return;
	const pending: Promise<boolean>[] = [];
	let current: Knex.Transaction | undefined = connection as Knex.Transaction;
	while (current) {
		const transaction: Knex.Transaction = current;
		let result = commits.get(transaction);
		if (!result) {
			let rolledBack = false;
			/** Distinguishes silent rollback from commit or savepoint release. */
			const query = (event: { sql: string }): void => {
				if (/^ROLLBACK/i.test(event.sql)) rolledBack = true;
				else if (/^(COMMIT|RELEASE SAVEPOINT)/i.test(event.sql)) rolledBack = false;
			};
			transaction.on('query', query);
			result = transaction.executionPromise.then(() => !rolledBack, () => false).finally(() => transaction.off('query', query));
			commits.set(transaction, result);
		}
		pending.push(result);
		current = transaction.parentTransaction;
	}
	return Promise.all(pending).then(results => results.every(Boolean));
}
