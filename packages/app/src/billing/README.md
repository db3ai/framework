# Billing

`@db3.ai/app/billing` bills an owner (an app id such as an organization) for
usage, with one invoice a month to a saved card, prepaid credit buckets and a
spend limit. Prices live in the checked-in `db3/billing.json`; the environment
holds only provider secrets. The payment provider sits behind the
`BillingProvider` port: `@db3.ai/billing-stripe` implements it.

```json
{
	"currency": "usd",
	"graceDays": 3,
	"newAccountSpendLimit": 5000,
	"prices": {
		"server.small": { "per": "month", "amount": 600, "label": "db3 Server (1 GB)" },
		"addon.security-monitor": { "per": "day", "amount": 10, "label": "Security monitor" },
		"domain.check": { "per": "use", "amount": 2, "label": "Domain check" }
	},
	"credits": {
		"ai": { "label": "AI credits", "packs": { "ai-10": { "amount": 1000, "credits": 1000 } }, "autoTopUp": { "below": 100, "pack": "ai-10" } }
	}
}
```

Amounts are minor units (cents).

| Price per | Charged as |
| --- | --- |
| `month` | Started hours at `amount / 672`, capped at `amount` per resource per month (a server). |
| `day` | Each UTC day the resource was on at any time (a switch-on add-on). |
| `use` | `quantity * amount`, each `key` counted once. |

```ts
import { stripeBillingProvider } from '@db3.ai/billing-stripe';

const application = new App({ billing: { provider: stripeBillingProvider() } });

// Before creating a server: card, standing and spend limit.
const check = await app().billing.checkSpend(org.id, app().billing.config.prices['server.small'].amount);
if (!check.allowed) return { setupUrl: await app().billing.cardSetupUrl({ ownerId: org.id, name: org.name, email, returnUrl }) };

await app().billing.startUsage({ ownerId: org.id, resourceId: server.id, price: 'server.small' });
await app().billing.startUsage({ ownerId: org.id, resourceId: server.id, price: 'server.medium' }); // resize
await app().billing.stopUsage({ ownerId: org.id, resourceId: server.id }); // destroy

// AI work spends prepaid credits; running out stops only that work.
await app().billing.spendCredits({ ownerId: org.id, bucket: 'ai', amount: 12, key: run.id });

// Monthly, from the scheduler: charge last month. Safe to run again.
await app().billing.invoicePeriod({ start: lastMonthStart, end: thisMonthStart });

// Webhook route: pass the raw body and signature header.
await app().billing.handleWebhook(rawBody, signature);
```

## Rules

- Usage is worked out at invoice time from spans and uses; nothing meters on a timer.
- A failed invoice makes the account `past_due`; paid work keeps running for
  `graceDays`, then `hasBilling()` is false. A dispute or fraud warning
  suspends at once and takes back any credits that charge granted.
- `newAccountSpendLimit` applies until the first invoice is paid; set
  `BillingAccount.spendLimit` to override one account.
- Provider calls never run inside a database transaction. Every write carries
  an idempotency key; webhooks are stored in `billing_events` before they are
  applied, and each provider event applies once.

## Tables

Register `billingModels` in the app's `server/database/models.ts`:
`billing_accounts`, `billing_usage_spans`, `billing_uses`, `billing_charges`,
`billing_credit_entries`, `billing_events`.

Depends on the database service only.
