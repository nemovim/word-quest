import type {
	LanguageCode,
	QuizDirectionMode,
	QuizExampleId,
	VocaId
} from '$lib/shared/types/general.type';
import type { PartOfSpeech } from '$lib/shared/types/voca.type';

export type QuizEncounter = {
	vocaId: VocaId;
	quizExampleId: QuizExampleId;
	difficultyLevel: number;
	utilityScore: number;
	partOfSpeech: PartOfSpeech;
	promptLang: LanguageCode;
	answerLang: LanguageCode;
	promptTemplate: string;
	promptFillText: string;
	answerTemplate: string;
	answerWordCount: number;
	pronunciationText: string;
	reviewStage: number;
	isNew: boolean;
};

export type QuizPageData = {
	directionMode: QuizDirectionMode;
	encounters: QuizEncounter[];
	isEmpty: boolean;
	emptyReason: 'new-voca-limit' | 'no-quiz' | null;
};
