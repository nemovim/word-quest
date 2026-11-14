import data from './cmudict/data.js';

type WordPronunciation = { word: string; candidates: string[] };
let dictionary: Map<string, string[]> | undefined;

function getDictionary() {
	if (dictionary) return dictionary;
	const entries = new Map<string, string[]>();
	for (const line of data.split(/\r?\n/)) {
		const match = line.match(/^(\S+?)(?:\(\d+\))?\s+(.+)$/);
		if (!match) continue;
		const candidates = entries.get(match[1]) ?? [];
		const pronunciation = match[2].split(/\s+#/u, 1)[0].trim();
		if (pronunciation && !candidates.includes(pronunciation)) candidates.push(pronunciation);
		entries.set(match[1], candidates);
	}
	dictionary = entries;
	return entries;
}

const IPA_PHONES: Record<string, string> = {
	AA: 'ɑ',
	AE: 'æ',
	AO: 'ɔ',
	AW: 'aʊ',
	AY: 'aɪ',
	EH: 'ɛ',
	EY: 'eɪ',
	IH: 'ɪ',
	IY: 'i',
	OW: 'oʊ',
	OY: 'ɔɪ',
	UH: 'ʊ',
	UW: 'u',
	B: 'b',
	CH: 'tʃ',
	D: 'd',
	DH: 'ð',
	F: 'f',
	G: 'ɡ',
	HH: 'h',
	JH: 'dʒ',
	K: 'k',
	L: 'l',
	M: 'm',
	N: 'n',
	NG: 'ŋ',
	P: 'p',
	R: 'ɹ',
	S: 's',
	SH: 'ʃ',
	T: 't',
	TH: 'θ',
	V: 'v',
	W: 'w',
	Y: 'j',
	Z: 'z',
	ZH: 'ʒ'
};

// CMUdict marks vowels, not syllable boundaries. Use a conservative English
// maximal-onset approximation to position the IPA stress mark for display.
const MULTI_PHONE_ONSETS = new Set([
	'P R',
	'P L',
	'P Y',
	'B R',
	'B L',
	'B Y',
	'T R',
	'T W',
	'T Y',
	'D R',
	'D W',
	'D Y',
	'K R',
	'K L',
	'K W',
	'K Y',
	'G R',
	'G L',
	'G W',
	'G Y',
	'F R',
	'F L',
	'F Y',
	'V R',
	'V Y',
	'TH R',
	'TH W',
	'TH Y',
	'SH R',
	'SH W',
	'S P',
	'S T',
	'S K',
	'S M',
	'S N',
	'S L',
	'S W',
	'S F',
	'S P R',
	'S P L',
	'S T R',
	'S K R',
	'S K W',
	'HH Y',
	'M Y',
	'N Y'
]);
const VOWELS = new Set([
	'AA',
	'AE',
	'AH',
	'AO',
	'AW',
	'AY',
	'EH',
	'ER',
	'EY',
	'IH',
	'IY',
	'OW',
	'OY',
	'UH',
	'UW'
]);

/** Render the CMU source as broad IPA. Stress syllable onsets are estimated. */
export function cmuPronunciationsToIpa(pronunciations: string[]): string {
	if (!pronunciations.length) throw new Error('At least one CMU pronunciation is required.');
	const words = pronunciations.map((pronunciation) => {
		const phones = pronunciation
			.trim()
			.split(/\s+/u)
			.map((token) => {
				const match = /^([A-Z]+)([012])?$/u.exec(token);
				if (!match) throw new Error(`Invalid CMU phone: ${token}`);
				const [, phone, stress] = match;
				const ipa =
					phone === 'AH'
						? stress === '0'
							? 'ə'
							: 'ʌ'
						: phone === 'ER'
							? stress === '0'
								? 'ɚ'
								: 'ɝ'
							: IPA_PHONES[phone];
				if (!ipa) throw new Error(`Unknown CMU phone: ${phone}`);
				return { phone, stress, ipa };
			});
		const vowelIndices = phones.flatMap((part, i) => (VOWELS.has(part.phone) ? [i] : []));
		if (!vowelIndices.length) throw new Error('CMU pronunciation has no vowel.');
		const markers = new Map<number, string>();
		if (vowelIndices.length > 1) {
			for (let n = 0; n < vowelIndices.length; n++) {
				const current = vowelIndices[n];
				const stress = phones[current].stress;
				if (stress !== '1' && stress !== '2') continue;
				let onset = n === 0 ? 0 : current;
				if (n > 0) {
					const previous = vowelIndices[n - 1];
					for (let j = previous + 1; j < current; j++) {
						const cluster = phones.slice(j, current).map((part) => part.phone);
						if (
							(cluster.length === 1 && cluster[0] !== 'NG') ||
							MULTI_PHONE_ONSETS.has(cluster.join(' '))
						) {
							onset = j;
							break;
						}
					}
				}
				markers.set(onset, stress === '1' ? 'ˈ' : 'ˌ');
			}
		}
		return phones.map((part, i) => `${markers.get(i) ?? ''}${part.ipa}`).join('');
	});
	return `/${words.join(' ')}/`;
}

/** Invalid or missing legacy data must not prevent a quiz answer from displaying. */
export function storedCmuPronunciationToIpa(value: string | undefined): string | undefined {
	if (!value?.trim()) return undefined;
	try {
		return cmuPronunciationsToIpa(value.split('|').map((word) => word.trim()));
	} catch {
		return undefined;
	}
}

/** Reject unsupported characters rather than silently omitting them. */
export function lookupCmuPronunciations(answer: string): {
	words: WordPronunciation[];
	missing: string[];
} {
	const normalized = answer.normalize('NFKC').replace(/[‘’]/g, "'").trim().toLowerCase();
	if (!normalized || /[^a-z'\s-]/.test(normalized)) return { words: [], missing: [answer] };
	const tokens = normalized.split(/[\s-]+/).filter(Boolean);
	if (!tokens.length) return { words: [], missing: [answer] };
	const dict = getDictionary();
	const words = tokens.map((word) => ({ word, candidates: dict.get(word) ?? [] }));
	return {
		words,
		missing: words.filter((word) => !word.candidates.length).map((word) => word.word)
	};
}
