import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { TextComponent } from 'obsidian';
import MarketplacePlugin from './main';
import { TOKEN_RE, UnauthorizedError } from './api/api';
import { API_BASE_URL } from './constants';
import { closeAccount, createToken, fetchMe, registerAccount, revokeToken } from './api/accountApi';
import { armButton } from './ui';

export interface MarketplaceSettings {
	/** Access token. The publish author comes from this, never from a form field. */
	token: string;
	/** Username from the server, for display only — /me is the source of truth. */
	username: string;
	/** Compared against a package's author_id to show "Delete" only on your own packages. */
	userId: string;
	downloadFolder: string;
}

export const DEFAULT_SETTINGS: MarketplaceSettings = {
	token: '',
	username: '',
	userId: '',
	downloadFolder: 'marketplace-downloads'
};

export class MarketplaceSettingTab extends PluginSettingTab {
	plugin: MarketplacePlugin;

	constructor(app: App, plugin: MarketplacePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Account for publishing notes').setHeading();
		if (this.plugin.settings.token) {
			this.renderLoggedIn(containerEl);
		} else {
			this.renderLoggedOut(containerEl);
		}

		new Setting(containerEl).setName('Downloads').setHeading();
		new Setting(containerEl)
			.setName('Download folder')
			.setDesc('Folder where packages downloaded from the marketplace end up.')
			.addText((text) =>
				text.setValue(this.plugin.settings.downloadFolder).onChange(async (value) => {
					this.plugin.settings.downloadFolder = value;
					await this.plugin.saveSettings();
				}),
			);
	}

	// --- logged out ---

	private renderLoggedOut(containerEl: HTMLElement): void {
		let username = '';

		new Setting(containerEl)
			.setName('Create a new account')
			.setDesc('Use 3 to 32 characters: letters, digits, underscore, hyphen.')
			.addText((text) =>
				text.setPlaceholder('Username').onChange((value) => {
					username = value;
				}),
			)
			.addButton((button) =>
				button
					.setButtonText('Create account')
					.setCta()
					.onClick(async () => {
						try {
							const account = await registerAccount(this.plugin.settings, username.trim());
							this.plugin.settings.token = account.token;
							await this.rememberIdentity(account);
							new Notice(
								`Account ${account.username} created. The token is in the field below — save it, ` +
									'the server will not show it again.',
								0,
							);
							this.display();
						} catch (error) {
							new Notice(this.describe(error, 'Failed to create account'));
						}
					}),
			);

		this.renderTokenField(containerEl, false);
	}

	// --- logged in ---

	private renderLoggedIn(containerEl: HTMLElement): void {
		const who = this.plugin.settings.username || '(unknown name)';

		new Setting(containerEl)
			.setName(`Logged in as: ${who}`)
			.setDesc('Checks whether the token still works and refreshes account data.')
			.addButton((button) =>
				button.setButtonText('Refresh').onClick(async () => {
					try {
						const account = await fetchMe(this.plugin.settings);
						await this.rememberIdentity(account);
						new Notice(`Logged in as ${account.username}. Tokens on this account: ${account.tokens}.`);
						this.display();
					} catch (error) {
						new Notice(this.describe(error, 'Connection error'));
					}
				}),
			);

		this.renderTokenField(containerEl, true);

		// A reversible action, so it lives next to the regular settings, not
		// in the danger zone below.
		new Setting(containerEl)
			.setName('Log out on this device')
			.setDesc('Removes the token only here. The token stays valid — paste it back in to return to the account.')
			.addButton((button) =>
				button.setButtonText('Log out').onClick(async () => {
					await this.forgetIdentity();
					new Notice('Logged out. The token still works — paste it back in to return.');
					this.display();
				}),
			);

		this.renderDangerZone(containerEl);
	}

	/** Irreversible actions live in their own section, away from everyday ones. */
	private renderDangerZone(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Advanced').setHeading();

		new Setting(containerEl)
			.setName('Token for another device')
			.setDesc('Issues an additional token. An account can have at most 10.')
			.addButton((button) =>
				button.setButtonText('Issue new').onClick(async () => {
					try {
						const token = await createToken(this.plugin.settings, 'obsidian');
						// This token isn't saved anywhere, so it must stay
						// visible on screen even if the clipboard copy fails.
						new Notice(`New token — save it now:\n${token}`, 0);
						await this.copy(token, 'New token');
					} catch (error) {
						new Notice(this.describe(error, 'Failed to issue token'));
					}
				}),
			);

		new Setting(containerEl)
			.setName('Revoke this token')
			.setDesc('Deletes the token on the server — use this if it leaked. If it is the account\'s only token, you will lose access to it.')
			.addButton((button) =>
				armButton(button, 'Revoke', 'Are you sure?', () => {
					void (async () => {
						try {
							await revokeToken(this.plugin.settings);
							new Notice('Token revoked');
						} catch (error) {
							console.error(error);
							new Notice('Failed to revoke on the server, removing locally.');
						}
						// Clear the local token even if the server call
						// failed — otherwise the user thinks it's revoked
						// when it still works.
						await this.forgetIdentity();
						this.display();
					})();
				}),
			);

		new Setting(containerEl)
			.setName('Close account')
			.setDesc('Deletes the account, its tokens, and all published packages. This cannot be undone.')
			.addButton((button) =>
				armButton(button, 'Close account', 'Delete everything?', () => {
					void (async () => {
						try {
							const removed = await closeAccount(this.plugin.settings);
							await this.forgetIdentity();
							new Notice(`Account closed. Packages deleted: ${removed}.`);
							this.display();
						} catch (error) {
							new Notice(this.describe(error, 'Failed to close account'));
						}
					})();
				}),
			);
	}

	/**
	 * The token input field.
	 *
	 * `addText()`'s callback runs synchronously while the `Setting` chain is
	 * still being built, so it can't reference `const setting` yet — that
	 * throws "Cannot access before initialization". The component is stored
	 * in `input` instead, and extra buttons are added after the chain ends.
	 */
	private renderTokenField(containerEl: HTMLElement, loggedIn: boolean): void {
		let input: TextComponent | null = null;

		const setting = new Setting(containerEl)
			.setName(loggedIn ? 'Your token' : 'I already have a token')
			.setDesc(
				(loggedIn
					? 'Save it somewhere safe — without it you cannot get back into the account. It sits as plain text in data.json inside the vault.'
					: 'Paste a token to return to an existing account. It starts with omp_ and is 68 characters long.') +
					// The server address can't be changed anymore, but it's
					// still useful to see where the token is going — e.g. to
					// tell a dev build apart from production.
					` Account runs on: ${API_BASE_URL}`,
			)
			.addText((text) => {
				input = text;
				text.inputEl.type = 'password'; // mask it in the UI
				text
					.setPlaceholder('Paste token')
					.setValue(this.plugin.settings.token)
					.onChange(async (value) => {
						const token = value.trim();
						this.plugin.settings.token = token;

						// Pasting a different token clears the cached
						// identity — otherwise "Delete" would still show up
						// on the previous account's packages.
						if (!TOKEN_RE.test(token)) {
							this.plugin.settings.username = '';
							this.plugin.settings.userId = '';
						}
						await this.plugin.saveSettings();
					});
			});

		// Without a reveal button there's no way to copy down a pasted
		// token, and without a saved copy, logging out would be a one-way trip.
		setting.addExtraButton((extra) =>
			extra
				.setIcon('eye')
				.setTooltip('Show or hide token')
				.onClick(() => {
					if (!input) return;
					const hidden = input.inputEl.type === 'password';
					input.inputEl.type = hidden ? 'text' : 'password';
					extra.setIcon(hidden ? 'eye-off' : 'eye');
				}),
		);

		if (loggedIn) {
			setting.addExtraButton((extra) =>
				extra
					.setIcon('copy')
					.setTooltip('Copy token to clipboard')
					.onClick(() => void this.copy(this.plugin.settings.token, 'Token')),
			);
		} else {
			setting.addButton((button) =>
				button
					.setButtonText('Log in')
					.setCta()
					.onClick(async () => {
						try {
							const account = await fetchMe(this.plugin.settings);
							await this.rememberIdentity(account);
							new Notice(`Logged in as ${account.username}`);
							this.display();
						} catch (error) {
							new Notice(this.describe(error, 'Failed to log in'));
						}
					}),
			);
		}
	}

	// --- helpers ---

	/** The server is the source of truth for identity; the local copy just tracks it. */
	private async rememberIdentity(account: { username: string; userId: string }): Promise<void> {
		this.plugin.settings.username = account.username;
		this.plugin.settings.userId = account.userId;
		await this.plugin.saveSettings();
	}

	private async forgetIdentity(): Promise<void> {
		this.plugin.settings.token = '';
		this.plugin.settings.username = '';
		this.plugin.settings.userId = '';
		await this.plugin.saveSettings();
	}

	/** The clipboard can be unavailable, and failing silently here would be painful. */
	private async copy(value: string, label: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(value);
			new Notice(`${label} copied to clipboard`);
		} catch {
			new Notice('Clipboard unavailable — copy the token manually from the field (the eye icon reveals it).');
		}
	}

	private describe(error: unknown, prefix: string): string {
		if (error instanceof UnauthorizedError) {
			return 'The server rejected the token. Check that it is correct.';
		}
		return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
	}
}
