# @db3.ai/billing-stripe

Stripe provider for [`@db3.ai/app/billing`](../app/src/billing/README.md).

```ts
import { App } from '@db3.ai/app';
import { stripeBillingProvider } from '@db3.ai/billing-stripe';

export const application = new App({ billing: { provider: stripeBillingProvider() } });
```

Secrets only, from the environment: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
Prices are not created in Stripe; each charge is a Stripe invoice built from
`db3/billing.json` amounts, so price changes need no Stripe setup.

- Cards are saved with Checkout in setup mode and set as the customer's default card.
- Usage invoices and credit packs are invoices paid off-session; a 3DS request
  returns `pending` with the hosted invoice page.
- Webhook events used: `checkout.session.completed`, `customer.updated`,
  `invoice.paid`, `invoice.payment_failed`, `charge.refunded`,
  `charge.dispute.created`, `radar.early_fraud_warning.created`. Others are
  stored and ignored.
