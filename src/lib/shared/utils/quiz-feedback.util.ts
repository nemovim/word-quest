import {
	AI_JUDGE_REASON_CODES,
	LANGUAGE_CODES,
	type AiJudgeReasonCode,
	type LanguageCode
} from '$lib/shared/types/general.type';
import { normalizeAnswer } from '$lib/shared/utils/answer.util';

export const AI_JUDGE_REASON_LABELS: Record<AiJudgeReasonCode, string> = {
	[AI_JUDGE_REASON_CODES.ALTERNATE_ANSWER]: '유사 답안',
	[AI_JUDGE_REASON_CODES.TYPO]: '철자',
	[AI_JUDGE_REASON_CODES.TENSE]: '시제',
	[AI_JUDGE_REASON_CODES.NUMBER]: '단수/복수',
	[AI_JUDGE_REASON_CODES.AGREEMENT]: '수 일치',
	[AI_JUDGE_REASON_CODES.ARTICLE]: '관사',
	[AI_JUDGE_REASON_CODES.WORD_FORM]: '단어 형태',
	[AI_JUDGE_REASON_CODES.UNNATURAL]: '부자연스러움',
	[AI_JUDGE_REASON_CODES.CONTEXT]: '문맥',
	[AI_JUDGE_REASON_CODES.MEANING]: '의미'
};

export const AI_JUDGE_REASON_FALLBACK_HINTS: Record<AiJudgeReasonCode, string> = {
	[AI_JUDGE_REASON_CODES.ALTERNATE_ANSWER]:
		'의도는 가깝지만 이 문장에서는 정확히 요구하는 표현과 일치하지 않아요.',
	[AI_JUDGE_REASON_CODES.TYPO]: '철자가 조금 달라요.',
	[AI_JUDGE_REASON_CODES.TENSE]: '시제가 맞지 않아요.',
	[AI_JUDGE_REASON_CODES.NUMBER]: '단수/복수 형태가 맞지 않아요.',
	[AI_JUDGE_REASON_CODES.AGREEMENT]: '수 일치가 맞지 않아요.',
	[AI_JUDGE_REASON_CODES.ARTICLE]: '관사 사용이 맞지 않아요.',
	[AI_JUDGE_REASON_CODES.WORD_FORM]: '품사나 활용 형태가 맞지 않아요.',
	[AI_JUDGE_REASON_CODES.UNNATURAL]: '문장 안에서 이 표현은 조금 부자연스러워요.',
	[AI_JUDGE_REASON_CODES.CONTEXT]: '뜻은 비슷하지만 이 문맥에는 어울리지 않아요.',
	[AI_JUDGE_REASON_CODES.MEANING]: '의미가 달라요.'
};

export const QUIZ_FEEDBACK_REASONS = {
	CORRECT: '정답',
	PASS: '정답 보기'
} as const;

export const QUIZ_FEEDBACK_HINTS = {
	CORRECT: '정답입니다.',
	PASS: '정답을 확인하고 같은 카드를 다시 복습해 보세요.'
} as const;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsEnglishExactAnswer(hintText: string, correctAnswerText: string): boolean {
	return new RegExp(`(?<![A-Za-z])${escapeRegExp(correctAnswerText)}(?![A-Za-z])`, 'i').test(
		hintText
	);
}

function containsExactAnswer(
	hintText: string,
	correctAnswerText: string,
	answerLang: LanguageCode
): boolean {
	const trimmedAnswer = correctAnswerText.trim();

	if (trimmedAnswer === '') {
		return false;
	}

	if (answerLang === LANGUAGE_CODES.EN) {
		return containsEnglishExactAnswer(hintText, trimmedAnswer);
	}

	return normalizeAnswer(hintText, answerLang).includes(normalizeAnswer(trimmedAnswer, answerLang));
}

export function getAiJudgeReasonLabel(reasonCode: AiJudgeReasonCode | null): string | null {
	return reasonCode == null ? null : AI_JUDGE_REASON_LABELS[reasonCode];
}

export function sanitizeAiJudgeHintText(
	reasonCode: AiJudgeReasonCode,
	hintText: string,
	answerLang: LanguageCode,
	correctAnswerText: string
): string {
	const normalizedHintText = hintText.trim();
	const fallbackHint = AI_JUDGE_REASON_FALLBACK_HINTS[reasonCode];

	if (normalizedHintText === '') {
		return fallbackHint;
	}

	if (containsExactAnswer(normalizedHintText, correctAnswerText, answerLang)) {
		return fallbackHint;
	}

	return normalizedHintText;
}
