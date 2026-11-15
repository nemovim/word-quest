import { lookupCmuPronunciations } from './cmu-pronunciation.ts';
import { resolveGenerationModel } from './model-config.ts';

export type PronunciationInput = { sentence: string; answer: string };
export type PronunciationResult =
	{ status: 'ok'; arpabet: string; hangul: string } | { status: 'deferred'; reason: string };

/** Resolve only pronunciation; existing example quality is not re-evaluated. */
export async function generateExamplePronunciations(
	inputs: PronunciationInput[],
	model = resolveGenerationModel(process.env.OPENROUTER_MODEL)
): Promise<PronunciationResult[]> {
	if (inputs.length > 5) throw new Error('At most five pronunciations can be requested at once.');
	const results: PronunciationResult[] = new Array(inputs.length);
	const pending = inputs.flatMap((input, index) => {
		const { words, missing } = lookupCmuPronunciations(input.answer);
		if (missing.length || !words.length) {
			results[index] = {
				status: 'deferred',
				reason: `cmudict_missing:${missing.join(',') || input.answer}`
			};
			return [];
		}
		return [{ index, ...input, words }];
	});
	if (!pending.length) return results;
	const key = process.env.OPENROUTER_API_KEY?.trim();
	if (!key) throw new Error('OPENROUTER_API_KEY is required.');
	const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model,
			messages: [
				{
					role: 'system',
					content:
						'For each English answer, choose the CMUdict ARPABET candidate for every word in the context of the sentence. Vowel digits denote stress. Write an approximate Korean Hangul pronunciation guide for the answer only, based on the selected candidates. Return JSON {"items":[{"index":0,"choices":[0],"hangul":"..."}]}; use zero-based candidate indices, or -1 if uncertain. Return every index once.'
				},
				{ role: 'user', content: JSON.stringify(pending) }
			],
			response_format: { type: 'json_object' },
			temperature: 0
		}),
		signal: AbortSignal.timeout(60000)
	});
	if (!response.ok) throw new Error(`Pronunciation request failed (${response.status}).`);
	const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
	let items: unknown;
	try {
		items = JSON.parse(data.choices?.[0]?.message?.content ?? '').items;
	} catch {
		throw new Error('Invalid pronunciation response JSON.');
	}
	if (!Array.isArray(items) || items.length !== pending.length)
		throw new Error('Invalid pronunciation response item count.');
	const seen = new Set<number>();
	for (const item of items) {
		const original = pending.find((entry) => entry.index === item?.index);
		if (!original || seen.has(item.index)) throw new Error('Invalid pronunciation response index.');
		seen.add(item.index);
		const valid =
			Array.isArray(item.choices) &&
			item.choices.length === original.words.length &&
			original.words.every(
				(word, i) =>
					Number.isInteger(item.choices[i]) &&
					item.choices[i] >= 0 &&
					item.choices[i] < word.candidates.length
			) &&
			typeof item.hangul === 'string' &&
			/[가-힣ㄱ-ㅣ]/.test(item.hangul) &&
			/^[가-힣ㄱ-ㅣ\s.,!?()\-~]+$/.test(item.hangul);
		results[item.index] = valid
			? {
					status: 'ok',
					arpabet: original.words.map((word, i) => word.candidates[item.choices[i]]).join(' | '),
					hangul: item.hangul.trim()
				}
			: { status: 'deferred', reason: 'pronunciation_uncertain' };
	}
	return results;
}
