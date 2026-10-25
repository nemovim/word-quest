const NAMED_HTML_ENTITIES: Readonly<Record<string, string>> = {
	amp: '&',
	apos: "'",
	gt: '>',
	lt: '<',
	nbsp: ' ',
	quot: '"'
};

const HTML_ENTITY_PATTERN = /&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);/gi;

function decodeEntity(entity: string, original: string): string {
	const normalizedEntity = entity.toLowerCase();

	if (normalizedEntity.startsWith('#x')) {
		return decodeCodePoint(Number.parseInt(normalizedEntity.slice(2), 16), original);
	}

	if (normalizedEntity.startsWith('#')) {
		return decodeCodePoint(Number.parseInt(normalizedEntity.slice(1), 10), original);
	}

	return NAMED_HTML_ENTITIES[normalizedEntity] ?? original;
}

function decodeCodePoint(codePoint: number, original: string): string {
	if (
		!Number.isInteger(codePoint) ||
		codePoint < 0 ||
		codePoint > 0x10ffff ||
		(codePoint >= 0xd800 && codePoint <= 0xdfff)
	) {
		return original;
	}

	return String.fromCodePoint(codePoint);
}

export function decodeHtmlEntities(value: string): string {
	let decoded = value;

	for (let pass = 0; pass < 3; pass += 1) {
		const next = decoded.replace(HTML_ENTITY_PATTERN, (original, entity: string) =>
			decodeEntity(entity, original)
		);

		if (next === decoded) {
			break;
		}

		decoded = next;
	}

	return decoded;
}
