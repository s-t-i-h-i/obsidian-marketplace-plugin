import { apiRequest } from './api';
import type { MarketplaceSettings } from '../settings';

export interface Account {
	userId: string;
	username: string;
	/** Ile tokenów ma konto - żeby ostrzec przed unieważnieniem ostatniego. */
	tokens: number;
}

/** Zakłada konto i zwraca token. Serwer pokazuje go dokładnie raz. */
export async function registerAccount(
	settings: MarketplaceSettings,
	username: string,
): Promise<Account & { token: string }> {
	const response = await apiRequest(settings, {
		path: '/register',
		method: 'POST',
		contentType: 'application/json',
		body: JSON.stringify({ username }),
	});

	const data = response.json as { user_id?: string; username?: string; token?: string };
	if (!data.token || !data.user_id) {
		throw new Error('Serwer nie zwrócił tokenu');
	}

	return {
		userId: data.user_id,
		username: data.username ?? username,
		token: data.token,
		tokens: 1,
	};
}

/** Sprawdza, czy token nadal działa, i kim według serwera jesteśmy. */
export async function fetchMe(settings: MarketplaceSettings): Promise<Account> {
	const response = await apiRequest(settings, { path: '/me', auth: true });

	const data = response.json as { user_id?: string; username?: string; tokens?: number };
	return {
		userId: data.user_id ?? '',
		username: data.username ?? '',
		tokens: data.tokens ?? 1,
	};
}

/** Unieważnia bieżący token po stronie serwera. */
export async function revokeToken(settings: MarketplaceSettings): Promise<void> {
	await apiRequest(settings, { path: '/tokens', method: 'DELETE', auth: true });
}

/**
 * Wydaje dodatkowy token dla zalogowanego konta.
 *
 * To jest warunek sensownej rotacji: żeby unieważnić skradziony token, trzeba
 * najpierw mieć czym się zalogować później. Bez tego "unieważnij" = "strać konto".
 */
export async function createToken(
	settings: MarketplaceSettings,
	label: string,
): Promise<string> {
	const response = await apiRequest(settings, {
		path: '/tokens',
		method: 'POST',
		contentType: 'application/json',
		body: JSON.stringify({ label }),
		auth: true,
	});

	const data = response.json as { token?: string };
	if (!data.token) throw new Error('Serwer nie zwrócił tokenu');

	return data.token;
}

/** Kasuje konto razem ze wszystkimi jego paczkami. Nieodwracalne. */
export async function closeAccount(settings: MarketplaceSettings): Promise<number> {
	const response = await apiRequest(settings, {
		path: '/account',
		method: 'DELETE',
		auth: true,
	});

	const data = response.json as { deleted_packages?: number };
	return data.deleted_packages ?? 0;
}
