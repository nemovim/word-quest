import { lookupCmuPronunciations } from './cmu-pronunciation.ts';
import { resolveGenerationModel } from './model-config.ts';

export type ExampleReviewInput = {
	sourceText: string;
	sourceDefinition: string;
	partOfSpeech: string;
	targetText: string;
	targetDefinition: string;
	targetLang: string;
	sourceSentence: string;
	sourceAnswer: string;
	targetSentence: string;
	targetAnswer: string;
	targetPronunciation: string;
	targetPronunciationArpabet?: string;
};

type Attempt = {
	model: string;
	probabilities: Record<string, number>;
	verdict?: string;
	usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
};
export type ExampleReviewResult = {
	status: 'accepted' | 'rejected' | 'deferred';
	accepted: boolean;
	attempts: Attempt[];
	reason?: string;
	targetPronunciation?: string;
	targetPronunciationArpabet?: string;
};

const PROMPT = [
	'Review each example independently as a strict bilingual quiz editor.',
	'Check (1) whether each complete sentence is grammatical and natural, (2) whether the sentences express the same situation and use the specified senses, and (3) whether sourceAnswer and targetAnswer themselves express the same essential meaning.',
	'Check both spans explicitly: essential modifiers, negation, direction, quantity and time expressed inside one span must not be omitted from the other span.',
	'Allow natural inflections, grammatical particles, and nonliteral idiomatic equivalents. Do not fail a good example merely because a different translation is also common.',
	'Return verdict accept, reject, or uncertain; use uncertain when genuinely unsure.',
	'For accepted English examples choose the CMUdict ARPABET pronunciation candidate matching each word in targetAnswer in context. Vowel digits denote stress.',
	'Write a Korean Hangul pronunciation guide ONLY for targetAnswer, not the entire sentence. For English, use the selected candidates. Korean is an approximate pronunciation, not a translation.',
	'Return one zero-based candidate index per word; use -1 if uncertain or no candidate fits.',
	'For non-English examples, generate the Hangul pronunciation of targetAnswer in the target language and return empty choices.',
	'Return JSON {"items":[{"index":0,"verdict":"accept|reject|uncertain","choices":[0],"hangul":"..."}]}. Return every index once. If verdict is not accept, use empty choices and empty hangul.'
].join(' ');

export async function reviewExamplesWithLuna(
	inputs: ExampleReviewInput[]
): Promise<ExampleReviewResult[]> {
	if (inputs.length > 5) throw new Error('At most five examples can be reviewed at once.');
	const results: ExampleReviewResult[] = new Array(inputs.length);
	type Pending = {
		index: number;
		input: ExampleReviewInput;
		words: ReturnType<typeof lookupCmuPronunciations>['words'] | null;
	};
	const pending = inputs.flatMap<Pending>((input, index) => {
		if (input.targetLang !== 'en') return [{ index, input, words: null }];
		const answer = lookupCmuPronunciations(input.targetAnswer);
		const headword = lookupCmuPronunciations(input.targetText);
		const missing = [...new Set([...headword.missing, ...answer.missing])];
		if (missing.length) {
			results[index] = {
				status: 'deferred',
				accepted: false,
				attempts: [],
				reason: `cmudict_missing:${missing.join(',')}`
			};
			return [];
		}
		return [{ index, input, words: answer.words }];
	});
	if (!pending.length) return results;
	const key = process.env.OPENROUTER_API_KEY?.trim();
	if (!key) throw new Error('OPENROUTER_API_KEY is required for example review.');
	const model = resolveGenerationModel(process.env.OPENROUTER_MODEL);
	const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: PROMPT },
				{
					role: 'user',
					content: JSON.stringify(
						pending.map(({ index, input, words }) => {
							const { targetPronunciation: _targetPronunciation, ...content } = input;
							delete content.targetPronunciationArpabet;
							return { ...content, index, words };
						})
					)
				}
			],
			response_format: { type: 'json_object' },
			temperature: 0
		}),
		signal: AbortSignal.timeout(60000)
	});
	if (!response.ok) throw new Error(`Example review request failed (${response.status}).`);
	const data = (await response.json()) as {
		model?: string;
		choices?: Array<{ message?: { content?: string } }>;
		usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
	};
	let items: unknown;
	try {
		items = JSON.parse(data.choices?.[0]?.message?.content ?? '').items;
	} catch {
		throw new Error('Invalid example review JSON.');
	}
	if (!Array.isArray(items) || items.length !== pending.length)
		throw new Error('Invalid example review item count.');
	const indices = new Set<number>();
	for (const item of items) {
		const original = pending.find((entry) => entry.index === item?.index);
		if (
			!original ||
			indices.has(item.index) ||
			!['accept', 'reject', 'uncertain'].includes(item.verdict)
		)
			throw new Error('Invalid example review item.');
		indices.add(item.index);
		const attempt: Attempt = {
			model: data.model || model,
			probabilities: {},
			verdict: item.verdict
		};
		if (item.index === pending[0].index)
			attempt.usage = {
				input_tokens: data.usage?.prompt_tokens,
				output_tokens: data.usage?.completion_tokens,
				cost: data.usage?.cost
			};
		if (item.verdict !== 'accept') {
			results[item.index] = {
				status: item.verdict === 'reject' ? 'rejected' : 'deferred',
				accepted: false,
				attempts: [attempt],
				...(item.verdict === 'uncertain' ? { reason: 'example_review_uncertain' } : {})
			};
			continue;
		}
		const validHangul =
			typeof item.hangul === 'string' &&
			/[가-힣ㄱ-ㅣ]/.test(item.hangul) &&
			/^[가-힣ㄱ-ㅣ\s.,!?()\-~]+$/.test(item.hangul);
		if (!validHangul) {
			results[item.index] = {
				status: 'deferred',
				accepted: false,
				attempts: [attempt],
				reason: 'pronunciation_uncertain'
			};
			continue;
		}
		if (original.words) {
			const validChoices =
				Array.isArray(item.choices) &&
				item.choices.length === original.words.length &&
				original.words.every(
					(word, i) =>
						Number.isInteger(item.choices[i]) &&
						item.choices[i] >= 0 &&
						item.choices[i] < word.candidates.length
				);
			if (!validChoices) {
				results[item.index] = {
					status: 'deferred',
					accepted: false,
					attempts: [attempt],
					reason: 'cmudict_selection_uncertain'
				};
				continue;
			}
		}
		const selected = original.words?.map((word, i) => word.candidates[item.choices[i]]);
		results[item.index] = {
			status: 'accepted',
			accepted: true,
			attempts: [attempt],
			targetPronunciation: item.hangul.trim(),
			...(selected ? { targetPronunciationArpabet: selected.join(' | ') } : {})
		};
	}
	return results;
}

/** Manual approval overrides example quality, but must still resolve an ambiguous CMU reading. */
export async function selectManualCmuPronunciation(
	input: ExampleReviewInput
): Promise<{ targetPronunciationArpabet: string }> {
	const { words, missing } = lookupCmuPronunciations(input.targetAnswer);
	if (missing.length) throw new Error('CMUdict에 없는 발음이 있어 예문을 승인할 수 없습니다.');
	let choices = words.map(() => 0);
	if (words.some((word) => word.candidates.length > 1)) {
		const key = process.env.OPENROUTER_API_KEY?.trim();
		if (!key) throw new Error('OPENROUTER_API_KEY is required for pronunciation selection.');
		const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: resolveGenerationModel(process.env.OPENROUTER_MODEL),
				messages: [
					{
						role: 'system',
						content:
							'Choose the CMUdict ARPABET candidate matching each word in answer in the sentence. Return JSON {"choices":[0,1]} with one zero-based candidate index per word, or -1 if uncertain.'
					},
					{
						role: 'user',
						content: JSON.stringify({
							sentence: input.targetSentence,
							answer: input.targetAnswer,
							words
						})
					}
				],
				response_format: { type: 'json_object' },
				temperature: 0
			}),
			signal: AbortSignal.timeout(60000)
		});
		if (!response.ok)
			throw new Error(`Pronunciation selection request failed (${response.status}).`);
		const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
		let value: unknown;
		try {
			value = JSON.parse(data.choices?.[0]?.message?.content ?? '').choices;
		} catch {
			throw new Error('발음 후보를 확인할 수 없습니다.');
		}
		if (
			!Array.isArray(value) ||
			value.length !== words.length ||
			words.some(
				(word, i) =>
					!Number.isInteger(value[i]) || value[i] < 0 || value[i] >= word.candidates.length
			)
		)
			throw new Error('발음 후보를 확정하지 못해 보류합니다.');
		choices = value as number[];
	}
	const selected = words.map((word, i) => word.candidates[choices[i]]);
	return { targetPronunciationArpabet: selected.join(' | ') };
}

export async function reviewExampleWithLuna(
	input: ExampleReviewInput
): Promise<ExampleReviewResult> {
	return (await reviewExamplesWithLuna([input]))[0];
}
