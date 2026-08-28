import { requestUrl } from 'obsidian';
import type { RequestUrlResponse } from 'obsidian';
import type { MarketplaceSettings } from './settings';

/** Format tokenu wydawanego przez serwer: 'omp_' + 64 znaki hex, same małe litery. */
export const TOKEN_RE = /^omp_[0-9a-f]{64}$/;

/**
 * Serwer odrzucił token (albo nie mamy go wcale). Osobna klasa, bo interfejs
 * musi odróżnić "zaloguj się" od zwykłej awarii sieci.
 */
export class UnauthorizedError extends Error {}

/** Każdy inny błąd HTTP - status zostaje, żeby wywołujący mógł zareagować. */
export class ApiError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(`${status}: ${message}`);
		this.status = status;
	}
}

interface ApiRequest {
	path: string;
	method?: 'GET' | 'POST' | 'DELETE';
	contentType?: string;
	body?: string | ArrayBuffer;
	/** Dokleja nagłówek Authorization i wymaga poprawnego tokenu. */
	auth?: boolean;
}

/**
 * Jedno miejsce, przez które przechodzą wszystkie żądania do marketplace'u.
 * Wcześniej obcinanie końcowego slasha, `throw: false` i sprawdzanie statusu
 * były przepisane w trzech kopiach, a publishApi.ts jako jedyny nie rozpakowywał
 * komunikatu błędu i pokazywał użytkownikowi surowy JSON.
 *
 * Zwraca surową odpowiedź: treść czyta wywołujący, bo `response.json` to getter
 * robiący JSON.parse - na archiwum ZIP zaczynającym się od "PK" rzuciłby wyjątkiem.
 */
export async function apiRequest(
	settings: MarketplaceSettings,
	req: ApiRequest,
): Promise<RequestUrlResponse> {
	const apiBaseUrl = settings.apiBaseUrl.trim();
	if (!apiBaseUrl) {
		throw new Error('Ustaw adres API w ustawieniach pluginu');
	}

	const headers: Record<string, string> = {};
	if (req.auth) {
		const token = settings.token.trim();
		// Zły format wyłapujemy lokalnie: nie ma po co jechać do serwera po 401,
		// a użytkownik od razu wie, że wkleił nie to co trzeba.
		if (!TOKEN_RE.test(token)) {
			throw new UnauthorizedError('Zaloguj się w ustawieniach pluginu');
		}
		headers.Authorization = `Bearer ${token}`;
	}

	const response = await requestUrl({
		url: `${apiBaseUrl.replace(/\/+$/, '')}${req.path}`,
		method: req.method ?? 'GET',
		...(req.contentType ? { contentType: req.contentType } : {}),
		...(req.body ? { body: req.body } : {}),
		headers,
		// domyślnie requestUrl rzuca wyjątkiem i gubi treść odpowiedzi serwera
		throw: false,
	});

	if (response.status === 401) {
		throw new UnauthorizedError(extractError(response.text));
	}
	if (response.status < 200 || response.status >= 300) {
		throw new ApiError(response.status, extractError(response.text));
	}

	return response;
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
