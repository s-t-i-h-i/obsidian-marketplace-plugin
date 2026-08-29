import { apiRequest } from './api';
import type { MarketplaceSettings } from '../settings';

export interface Account {
	userId: string;
	username: string;
	/** How many tokens the account has, so the UI can warn before revoking the last one. */
	tokens: number;
}

/** Registers an account and returns the token. The server shows it exactly once. */
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
		throw new Error('The server did not return a token');
	}

	return {
		userId: data.user_id,
		username: data.username ?? username,
		token: data.token,
		tokens: 1,
	};
}

/** Checks whether the token still works, and who the server thinks we are. */
export async function fetchMe(settings: MarketplaceSettings): Promise<Account> {
	const response = await apiRequest(settings, { path: '/me', auth: true });

	const data = response.json as { user_id?: string; username?: string; tokens?: number };
	return {
		userId: data.user_id ?? '',
		username: data.username ?? '',
		tokens: data.tokens ?? 1,
	};
}

/** Revokes the current token on the server. */
export async function revokeToken(settings: MarketplaceSettings): Promise<void> {
	await apiRequest(settings, { path: '/tokens', method: 'DELETE', auth: true });
}

/**
 * Issues an additional token for the logged-in account.
 *
 * This is what makes rotation possible: revoking a stolen token only makes
 * sense if you have another one to log back in with. Without it, "revoke"
 * would mean "lose the account".
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
	if (!data.token) throw new Error('The server did not return a token');

	return data.token;
}

/** Deletes the account along with all its packages. Irreversible. */
export async function closeAccount(settings: MarketplaceSettings): Promise<number> {
	const response = await apiRequest(settings, {
		path: '/account',
		method: 'DELETE',
		auth: true,
	});

	const data = response.json as { deleted_packages?: number };
	return data.deleted_packages ?? 0;
}
