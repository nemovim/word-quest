export type WrongResult = {
	correctAnswer?: string;
	pronunciationText?: string;
	status: 'wrong';
	reasonCode: string | null;
	reasonLabel: string | null;
	hintText: string | null;
	initialHint: string;
	spellingDistance?: number | null;
	canJudge: boolean;
	canRegenerate: boolean;
};

export type SolvedResult = {
	status: 'correct' | 'pass';
	reasonLabel: string;
	hintText: string;
	correctAnswer: string;
	pronunciationText: string;
	reviewStage: number;
	nextReviewLabel: string;
};

export type QuizResult = WrongResult | SolvedResult;
