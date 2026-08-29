import { apiRequest } from './api';
import type { MarketplaceSettings } from '../settings';

/** Paczka w postaci, jakiej oczekuje interfejs - pola zawsze istnieją i mają właściwy typ. */
export interface Package {
	id: string;
	title: string;
	description: string;
	author: string;
	/** Właściciel wg serwera. Puste dla paczek sprzed wprowadzenia kont. */
	authorId: string;
	tags: string[];
	filename: string;
	createdAt: string;
	/** Ścieżki względne plików w archiwum. Puste na liście - wypełnia je fetchPackage(). */
	structure: string[];
}

export async function downloadPackageArchive(
	settings: MarketplaceSettings,
	id: string,
): Promise<ArrayBuffer> {
	const response = await apiRequest(settings, {
		path: `/download/${encodeURIComponent(id)}`,
	});

	// Nie sięgamy tu po response.json - to getter robiący JSON.parse, a archiwum
	// zaczyna się od "PK", więc rzuciłby SyntaxError.
	if (!response.arrayBuffer || response.arrayBuffer.byteLength === 0) {
		throw new Error('The downloaded file is empty');
	}

	return response.arrayBuffer;
}

/**
 * Szczegóły jednej paczki, ze strukturą folderów.
 * Lista celowo tego nie zwraca - przy setce paczek byłby to spory zbędny transfer.
 */
export async function fetchPackage(
	settings: MarketplaceSettings,
	id: string,
): Promise<Package> {
	const response = await apiRequest(settings, {
		path: `/packages/${encodeURIComponent(id)}`,
	});

	return toPackage(response.json);
}

/** Pobiera listę paczek z serwera marketplace. */
export async function fetchPackages(settings: MarketplaceSettings): Promise<Package[]> {
	const response = await apiRequest(settings, { path: '/packages' });

	const data: unknown = response.json;
	if (!Array.isArray(data)) {
		throw new Error('The server returned something other than a package list');
	}

	return data.map(toPackage);
}

/** Usuwa własną paczkę. Właściciela i tak weryfikuje serwer. */
export async function deletePackage(
	settings: MarketplaceSettings,
	id: string,
): Promise<void> {
	await apiRequest(settings, {
		path: `/packages/${encodeURIComponent(id)}`,
		method: 'DELETE',
		auth: true,
	});
}

/** Zamienia surowy wiersz z bazy na bezpieczny obiekt Package. */
function toPackage(raw: unknown): Package {
	const row = (raw ?? {}) as Record<string, unknown>;
	return {
		id: asText(row.id),
		title: asText(row.title) || '(untitled)',
		description: asText(row.description),
		author: asText(row.author),
		// paczki zastane mają author_id = null, a asText() robi z tego pusty string
		authorId: asText(row.author_id),
		tags: toTags(row.tags),
		filename: asText(row.filename),
		createdAt: asText(row.created_at),
		structure: toStructure(row.structure),
	};
}

/** `structure` przychodzi jako JSON-owa tablica ścieżek w tekście. */
function toStructure(value: unknown): string[] {
	if (typeof value !== 'string' || !value) return [];

	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry): entry is string => typeof entry === 'string');
	} catch {
		// uszkodzony JSON to powód, żeby nie pokazać drzewa - nie żeby wywalić listę
		return [];
	}
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
