export function makeFormData(fields: Record<string, string>): FormData {
	const formData = new FormData();

	for (const [key, value] of Object.entries(fields)) {
		formData.set(key, value);
	}

	return formData;
}
