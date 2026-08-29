import { requestUrl } from 'obsidian';
import type { RequestUrlResponse } from 'obsidian';
import type { MarketplaceSettings } from '../settings';
import { API_BASE_URL } from '../constants';

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
	// Adres jest stałą z builda, więc nie ma tu już czego bronić przed użytkownikiem.
	// Kontrola zostaje jako ostatnia bramka i jako normalizacja końcowego slasha;
	// tę samą listę warunków sprawdza esbuild.config.mjs, zanim adres w ogóle
	// trafi do main.js.
	const apiBaseUrl = assertSafeApiUrl(API_BASE_URL);

	const headers: Record<string, string> = {};
	if (req.auth) {
		const token = settings.token.trim();
		// Zły format wyłapujemy lokalnie: nie ma po co jechać do serwera po 401,
		// a użytkownik od razu wie, że wkleił nie to co trzeba.
		if (!TOKEN_RE.test(token)) {
			throw new UnauthorizedError('Log in from the plugin settings');
		}
		headers.Authorization = `Bearer ${token}`;
	}

	const response = await requestUrl({
		url: `${apiBaseUrl}${req.path}`,
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

/**
 * Sprawdza adres serwera, ZANIM poleci do niego token.
 *
 * Adres był kiedyś polem tekstowym w ustawieniach, czyli atakiem socjotechnicznym
 * na jedno wklejenie: "żeby dostać paczkę X, ustaw adres API na ...". Token leci
 * nagłówkiem przy każdym uwierzytelnionym żądaniu, więc podmiana adresu oddawała
 * konto. Dziś adres pochodzi z builda, a ta sama lista warunków stoi w
 * esbuild.config.mjs - tutaj zostaje jako ostatnia bramka i jako normalizacja.
 */
export function assertSafeApiUrl(raw: string): string {
	const value = raw.trim();
	if (!value) {
		// Nie do zobaczenia przez użytkownika: znaczy tyle, że build nie wstawił
		// stałej. Komunikat celuje w tego, kto buduje wtyczkę.
		throw new Error('The API address was not compiled in - rebuild the plugin');
	}

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`The API address is not a valid URL: ${value}`);
	}

	if (url.protocol !== 'https:' && !isLocalhost(url.hostname)) {
		// http:// niesie token otwartym tekstem, a ten nie wygasa - jedno podsłuchanie
		// w sieci publicznej daje dostęp na zawsze. Localhost zostaje, bo to tryb pracy
		// z `wrangler dev` i ruch nie opuszcza maszyny.
		throw new Error('The API address must use https:// (localhost is the exception)');
	}

	// Dane logowania w URL-u trafiłyby do nagłówka Authorization obok naszego tokenu.
	if (url.username || url.password) {
		throw new Error('The API address cannot contain a username or password');
	}

	// Ścieżkę doklejamy sami; bazowy adres z własną ścieżką albo zapytaniem
	// przestawiłby każdy endpoint w nieprzewidziane miejsce.
	if (url.search || url.hash) {
		throw new Error('The API address cannot contain query parameters or a fragment');
	}

	return url.origin + url.pathname.replace(/\/+$/, '');
}

function isLocalhost(hostname: string): boolean {
	return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
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
