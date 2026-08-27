import { requestUrl } from 'obsidian';

/** Kurs w postaci, jakiej oczekuje interfejs - pola zawsze istnieją i mają właściwy typ. */
export interface Course {
	id: string;
	title: string;
	description: string;
	author: string;
	tags: string[];
	filename: string;
	createdAt: string;
}

export async function downloadCourseArchive(apiBaseUrl: string, id: string): Promise<ArrayBuffer>{
	const response = await requestUrl({
		url: `${apiBaseUrl.replace(/\/+$/, '')}/download/${encodeURIComponent(id)}`,
		method: 'GET',
		throw: false,
	})

	if (response.status < 200 || response.status >= 300) {
		throw new Error(`${response.status}: ${extractError(response.text)}`);
	}
	// add byteLength check to ensure the response is not empty
	if (!response.arrayBuffer || response.arrayBuffer.byteLength === 0) {
		throw new Error('Pobrany plik jest pusty');
	}

	return response.arrayBuffer;
}


/** Pobiera listę kursów z serwera marketplace. */
export async function fetchCourses(apiBaseUrl: string): Promise<Course[]> {
	const response = await requestUrl({
		url: `${apiBaseUrl.replace(/\/+$/, '')}/courses`,
		method: 'GET',
		// tak samo jak w publishApi: chcemy zobaczyć treść błędu z serwera
		throw: false,
	});

	if (response.status < 200 || response.status >= 300) {
		throw new Error(`${response.status}: ${extractError(response.text)}`);
	}

	const data: unknown = response.json;
	if (!Array.isArray(data)) {
		throw new Error('Serwer zwrócił coś innego niż listę kursów');
	}

	return data.map(toCourse);
}

/** Serwer przy błędzie zwraca {"error": "..."} - wyciągamy sam komunikat. */
function extractError(text: string): string {
	try {
		const parsed: unknown = JSON.parse(text);
		if (parsed && typeof parsed === 'object' && 'error' in parsed) {
			return String(parsed.error);
		}
	} catch {
		// nie JSON - pokażemy surową treść
	}
	return text;
}

/** Zamienia surowy wiersz z bazy na bezpieczny obiekt Course. */
function toCourse(raw: unknown): Course {
	const row = (raw ?? {}) as Record<string, unknown>;
	return {
		id: asText(row.id),
		title: asText(row.title) || '(bez tytułu)',
		description: asText(row.description),
		author: asText(row.author),
		tags: toTags(row.tags),
		filename: asText(row.filename),
		createdAt: asText(row.created_at),
	};
}

/** Liczby z SQLite zamienia na tekst, wszystko inne (null, undefined) na pusty string. */
function asText(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	return '';
}

/** `tags` przychodzi jako "ts,nauka" - rozbijamy na tablicę i czyścimy puste. */
function toTags(value: unknown): string[] {
	const list = Array.isArray(value) ? value.map(asText) : asText(value).split(',');
	return list.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
}
