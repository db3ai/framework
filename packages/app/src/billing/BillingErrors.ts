/** The owner has no saved card, or the provider is not configured. */
export class BillingNotSetUpError extends Error {
	constructor(readonly ownerId: string, message = `Billing is not set up for ${ownerId}.`) {
		super(message);
		this.name = 'BillingNotSetUpError';
	}
}

/** A credit spend was refused because the bucket balance is too low. */
export class BillingCreditsExhaustedError extends Error {
	constructor(readonly ownerId: string, readonly bucket: string, readonly balance: number, readonly topUpStarted: boolean) {
		super(`Not enough ${bucket} credits for ${ownerId}: ${balance} left${topUpStarted ? '; a top-up has started' : ''}.`);
		this.name = 'BillingCreditsExhaustedError';
	}
}

/** A webhook's signature did not verify; answer 400 and do not retry. */
export class BillingWebhookSignatureError extends Error {
	constructor(message = 'The billing webhook signature did not verify.') {
		super(message);
		this.name = 'BillingWebhookSignatureError';
	}
}
