import type { AnswerMemo } from '$lib/shared/types/answer-memo.type';
import type { QuizCard, QuizExample } from '$lib/shared/types/quiz-card.type';
import type { QuizEncounter } from '$lib/shared/types/quiz.type';
import type { Review } from '$lib/shared/types/review.type';
import type { User } from '$lib/shared/types/user.type';
import type { Voca } from '$lib/shared/types/voca.type';

import {
	AI_JUDGE_REASON_CODES,
	KOREAN_LANGUAGE_CODE,
	LANGUAGE_CODES
} from '$lib/shared/types/general.type';
import { PARTS_OF_SPEECH } from '$lib/shared/types/voca.type';

export function makeUser(overrides: Partial<User> = {}): User {
	return {
		_id: 'user-1',
		email: 'user@example.com',
		name: 'Test User',
		currentLevel: 3,
		levelHistory: [],
		createdAt: '2026-06-23T00:00:00.000Z',
		updatedAt: '2026-06-23T00:00:00.000Z',
		...overrides
	};
}

export function makeVoca(overrides: Partial<Voca> = {}): Voca {
	return {
		_id: 'voca-1',
		originKey: 'krdict:1:1:en:apple',
		sourceText: 'source-word',
		sourceDefinition: 'source definition',
		partOfSpeech: PARTS_OF_SPEECH.NOUN,
		targetLang: LANGUAGE_CODES.EN,
		targetText: 'apple',
		normalizedTargetText: 'apple',
		targetDefinition: 'a kind of fruit',
		difficultyLevel: 3,
		utilityScore: 5,
		...overrides
	};
}

export function makeQuizExample(overrides: Partial<QuizExample> = {}): QuizExample {
	return {
		_id: 'example-1',
		sourceSentenceTemplate: 'I ate {{---}} on the source side.',
		sourceFillText: 'source-word',
		targetSentenceTemplate: 'I ate {{---}}.',
		targetFillText: 'apple',
		targetPronunciationText: '?좏뵆',
		reportCount: 0,
		addedAt: '2026-06-23T00:00:00.000Z',
		...overrides
	};
}

export function makeQuizCard(overrides: Partial<QuizCard> = {}): QuizCard {
	return {
		_id: 'card-1',
		vocaId: 'voca-1',
		examples: [makeQuizExample()],
		createdAt: '2026-06-23T00:00:00.000Z',
		updatedAt: '2026-06-23T00:00:00.000Z',
		...overrides
	};
}

export function makeReview(overrides: Partial<Review> = {}): Review {
	return {
		_id: 'review-1',
		userId: 'user-1',
		vocaId: 'voca-1',
		promptLang: KOREAN_LANGUAGE_CODE,
		answerLang: LANGUAGE_CODES.EN,
		reviewStage: 2,
		dueAt: '2026-06-23T00:00:00.000Z',
		lastReviewedAt: '2026-06-23T00:00:00.000Z',
		correctCount: 0,
		wrongCount: 0,
		exampleScoreById: {},
		createdAt: '2026-06-23T00:00:00.000Z',
		updatedAt: '2026-06-23T00:00:00.000Z',
		...overrides
	};
}

export function makeAnswerMemo(overrides: Partial<AnswerMemo> = {}): AnswerMemo {
	return {
		_id: 'memo-1',
		vocaId: 'voca-1',
		quizExampleId: 'example-1',
		promptLang: KOREAN_LANGUAGE_CODE,
		answerLang: LANGUAGE_CODES.EN,
		normalizedAnswerText: 'pear',
		reasonCode: AI_JUDGE_REASON_CODES.TYPO,
		hintText: 'small spelling issue',
		retryCount: 0,
		createdAt: '2026-06-23T00:00:00.000Z',
		updatedAt: '2026-06-23T00:00:00.000Z',
		...overrides
	};
}

export function makeQuizEncounter(overrides: Partial<QuizEncounter> = {}): QuizEncounter {
	return {
		vocaId: 'voca-1',
		quizExampleId: 'example-1',
		difficultyLevel: 3,
		utilityScore: 5,
		partOfSpeech: PARTS_OF_SPEECH.NOUN,
		promptLang: KOREAN_LANGUAGE_CODE,
		answerLang: LANGUAGE_CODES.EN,
		promptTemplate: 'prompt {{---}}',
		promptFillText: '?⑥뼱',
		answerTemplate: 'answer {{---}}',
		answerWordCount: 1,
		pronunciationText: '?좏뵆',
		reviewStage: 2,
		isNew: false,
		...overrides
	};
}
