import { describe, expect, it } from 'vitest';

import { decodeHtmlEntities } from '$lib/shared/utils/html-entity.util';

describe('decodeHtmlEntities', () => {
	it('decodes dictionary HTML entities and numeric entities', () => {
		expect(decodeHtmlEntities('one&apos;s &quot;word&quot; &#39;test&#x21;')).toBe(
			`one's "word" 'test!`
		);
	});

	it('decodes nested entities without changing unknown or invalid entities', () => {
		expect(decodeHtmlEntities('&amp;apos; &unknown; &#xD800;')).toBe("' &unknown; &#xD800;");
	});
});
