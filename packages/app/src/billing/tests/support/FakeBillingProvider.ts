import type { BillingChargeStatus, BillingProvider, BillingProviderEvent } from '../../contracts';

/** In-memory provider: records calls, returns scripted charge outcomes, accepts JSON webhooks signed "ok". */
export class FakeBillingProvider implements BillingProvider {
	readonly calls: { method: string; input: any }[] = [];
	nextStatus: BillingChargeStatus = 'paid';
	#ids = 0;
	readonly #byKey = new Map<string, string>();

	async createCustomer(input: any) { this.calls.push({ method: 'createCustomer', input }); return { customerId: `cus_${input.accountId}` }; }
	async cardSetupUrl(input: any) { this.calls.push({ method: 'cardSetupUrl', input }); return { url: `https://pay.test/setup/${input.customerId}` }; }
	async portalUrl(input: any) { this.calls.push({ method: 'portalUrl', input }); return { url: `https://pay.test/portal/${input.customerId}` }; }
	async chargeInvoice(input: any) { this.calls.push({ method: 'chargeInvoice', input }); return this.#charge(input.idempotencyKey, 'in'); }
	async chargeOnce(input: any) { this.calls.push({ method: 'chargeOnce', input }); return this.#charge(input.idempotencyKey, 'pi'); }

	async parseWebhook(rawBody: Buffer, signature: string): Promise<BillingProviderEvent> {
		if (signature !== 'ok') throw new Error('bad signature');
		return JSON.parse(rawBody.toString('utf8'));
	}

	#charge(key: string, prefix: string) {
		const providerId = this.#byKey.get(key) ?? `${prefix}_${++this.#ids}`;
		this.#byKey.set(key, providerId);
		return { providerId, status: this.nextStatus, ...(this.nextStatus === 'pending' ? { payUrl: `https://pay.test/${providerId}` } : {}) };
	}
}
