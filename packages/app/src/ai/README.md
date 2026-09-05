# AI text generation

The first shared AI capability is a stateless OpenAI text client. It is used by
the `@db3.ai/create` notes starter. This is not yet Scout's complete agent,
embedding, image generation, failover or accounting system.

```ts
import { OpenAIText } from '@db3.ai/app/ai';

const ai = new OpenAIText({
	apiKey: process.env.OPENAI_API_KEY!,
	model: process.env.OPENAI_MODEL!,
});
const result = await ai.generate({
	instructions: 'Summarise the supplied note in three short bullet points.',
	input: note.body,
	maxOutputTokens: 400,
});
```

Only create the client when the app developer has supplied a key. Keep it on the
server. Authorize the source record before sending any text to OpenAI. No key is
bundled, read from Scout, or provisioned by the generator.

`generate()` sends one Responses request, disables automatic retries, sets
`store: false`, and defaults to a 30-second timeout. Disabling response storage
is not a zero-retention guarantee: OpenAI's data policies still apply. A timeout
or cancellation can still incur provider cost. The app owns input limits,
authorization, rate limits, spending controls and any persistence.

`TextGenerationError.code` distinguishes configuration, invalid input, timeout,
cancellation, rate limits, other provider failures and incomplete output. Errors
do not retain provider bodies or credentials. `result.usage` is measured token
usage, not monetary cost, an invoice or an allowance ledger.

## Testing

In the framework checkout only, run
`npm run test:service --workspace packages/app -- ai`. The installed package
does not contain a workspace or test scripts. In a consumer app, copy the exact
test from the [AI guide](https://db3.ai/docs/ai#testing), then run
`npx vitest run tests/ai/OpenAIText.test.ts` with the guide's development tools.
Tests replace only external HTTP, use a dummy key and never make a live request.
Consumers may pass `fetch` for deterministic provider tests.

## Coverage

Implemented: bounded text generation, output/usage parsing, missing configuration,
input validation, safe provider errors, cancellation and incomplete responses.
TODO: streaming, structured outputs, tools/agents, images, embeddings, durable
request tracking, monetary costing, allowances and failovers.

Provider contract: [OpenAI Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses).
