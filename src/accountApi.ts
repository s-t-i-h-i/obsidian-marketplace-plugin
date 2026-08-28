import { apiRequest } from './api';
import type { MarketplaceSettings } from './settings';

export interface Account {
	userId: string;
	username: string;
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
	};
}

/** Sprawdza, czy token nadal działa, i kim według serwera jesteśmy. */
export async function fetchMe(settings: MarketplaceSettings): Promise<Account> {
	const response = await apiRequest(settings, { path: '/me', auth: true });

	const data = response.json as { user_id?: string; username?: string };
	return {
		userId: data.user_id ?? '',
		username: data.username ?? '',
	};
}

/** Unieważnia bieżący token po stronie serwera. */
export async function revokeToken(settings: MarketplaceSettings): Promise<void> {
	await apiRequest(settings, { path: '/tokens', method: 'DELETE', auth: true });
}
