/**
 * Reads a decoded HTTP response while enforcing the byte budget before retaining
 * each chunk. Content-Length is only an early rejection hint; streamed and
 * decompressed bytes remain authoritative. Over-budget bodies are cancelled.
 *
 * @param response - Unconsumed fetch response owned by the caller.
 * @param maxBytes - Positive maximum number of decoded bytes to retain.
 * @returns Complete response bytes, or an empty array for a bodyless response.
 * @throws RangeError when the declared or streamed body exceeds the budget.
 */
export async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Response byte limit must be a positive integer.');
	if (Number(response.headers.get('content-length')) > maxBytes) {
		await response.body?.cancel();
		throw new RangeError(`Response exceeds the ${maxBytes}-byte limit.`);
	}
	const reader = response.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value.byteLength > maxBytes - size) {
				await reader.cancel();
				throw new RangeError(`Response exceeds the ${maxBytes}-byte limit.`);
			}
			chunks.push(value);
			size += value.byteLength;
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

/**
 * Decodes a complete UTF-8 response only after its byte budget has been enforced.
 * The caller owns the fetch timeout, which must cover body consumption as well.
 *
 * @param response - Unconsumed fetch response owned by the caller.
 * @param maxBytes - Positive maximum decoded response size in bytes.
 * @returns UTF-8 response text within the byte limit.
 */
export async function readResponseText(response: Response, maxBytes: number): Promise<string> {
	return new TextDecoder().decode(await readResponseBytes(response, maxBytes));
}
