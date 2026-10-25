export type UserId = string;
export type VocaId = string;
export type QuizCardId = string;
export type QuizExampleId = string;
export type ReviewId = string;
export type AnswerMemoId = string;

export const LANGUAGE_CODES = {
	AR: 'ar',
	EN: 'en',
	ES: 'es',
	FR: 'fr',
	ID: 'id',
	JA: 'ja',
	KO: 'ko',
	MN: 'mn',
	RU: 'ru',
	TH: 'th',
	VI: 'vi',
	ZH: 'zh'
} as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[keyof typeof LANGUAGE_CODES];

export const KOREAN_LANGUAGE_CODE = LANGUAGE_CODES.KO;

export const TARGET_LANGUAGE_OPTIONS = [
	{ code: LANGUAGE_CODES.EN, label: '영어' },
	{ code: LANGUAGE_CODES.JA, label: '일본어' },
	{ code: LANGUAGE_CODES.ZH, label: '중국어' },
	{ code: LANGUAGE_CODES.FR, label: '프랑스어' },
	{ code: LANGUAGE_CODES.ES, label: '스페인어' },
	{ code: LANGUAGE_CODES.AR, label: '아랍어' },
	{ code: LANGUAGE_CODES.MN, label: '몽골어' },
	{ code: LANGUAGE_CODES.VI, label: '베트남어' },
	{ code: LANGUAGE_CODES.TH, label: '태국어' },
	{ code: LANGUAGE_CODES.ID, label: '인도네시아어' },
	{ code: LANGUAGE_CODES.RU, label: '러시아어' }
] as const;

export const QUIZ_DIRECTION_MODES = {
	KO_TO_TARGET: 'ko_to_target',
	TARGET_TO_KO: 'target_to_ko'
} as const;

export type QuizDirectionMode = (typeof QUIZ_DIRECTION_MODES)[keyof typeof QUIZ_DIRECTION_MODES];

export const AI_JUDGE_REASON_CODES = {
	ALTERNATE_ANSWER: 'alternateAnswer',
	TYPO: 'typo',
	TENSE: 'tense',
	NUMBER: 'number',
	AGREEMENT: 'agreement',
	ARTICLE: 'article',
	WORD_FORM: 'wordForm',
	UNNATURAL: 'unnatural',
	CONTEXT: 'context',
	MEANING: 'meaning'
} as const;

export type AiJudgeReasonCode = (typeof AI_JUDGE_REASON_CODES)[keyof typeof AI_JUDGE_REASON_CODES];

export const REVIEW_STAGE_DELAYS = {
	0: 60,
	1: 60 * 10,
	2: 60 * 60 * 24 * 1,
	3: 60 * 60 * 24 * 3,
	4: 60 * 60 * 24 * 7,
	5: 60 * 60 * 24 * 21,
	6: 60 * 60 * 24 * 60,
	7: 60 * 60 * 24 * 365
} as const;

export const REVIEW_STAGE_LABELS = {
	0: '1분',
	1: '10분',
	2: '1일',
	3: '3일',
	4: '7일',
	5: '3주',
	6: '2달',
	7: '1년'
} as const;

export const QUIZ_TEMPLATE_SLOT = '{{---}}' as const;

export const EXAMPLE_SCORE_MAX = 5;
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;
export const INVALID_UTILITY_SCORE = 0;
export const MIN_UTILITY_SCORE = INVALID_UTILITY_SCORE;
export const MIN_RECOMMENDED_UTILITY_SCORE = 1;
export const MAX_UTILITY_SCORE = 5;
export const DEFAULT_QUIZ_SESSION_SIZE = 5;
export const DEFAULT_NEW_VOCA_FILL_COUNT = 6;
export const DEFAULT_EXAMPLE_COUNT_PER_CARD = 3;
export const LONG_TERM_REVIEW_STAGE = 5;
export const MAX_REVIEW_STAGE = 7;
export const LEVEL_HISTORY_INTERVAL_MS = 1000 * 60 * 60 * 6;
