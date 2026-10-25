export type AddContextValues = {
	sourceText: string;
	targetLang: string;
	targetText: string;
	meaningHint: string;
};

export type AddVocaSummary = {
	_id?: string;
	sourceText: string;
	sourceDefinition: string;
	targetText: string;
	targetDefinition?: string | null;
	difficultyLevel?: number | null;
	utilityScore?: number | null;
};
