import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { TextComponent } from 'obsidian';
import MarketplacePlugin from './main';
import { TOKEN_RE, UnauthorizedError } from './api/api';
import { closeAccount, createToken, fetchMe, registerAccount, revokeToken } from './api/accountApi';
import { armButton } from './ui';

export interface MarketplaceSettings {
	apiBaseUrl: string;
	/** Token dostępowy. Autor publikacji bierze się z niego, nie z formularza. */
	token: string;
	/** Nazwa z serwera - tylko do wyświetlenia. Źródłem prawdy jest /me. */
	username: string;
	/** Porównywane z author_id paczki, żeby pokazać "Usuń" tylko przy swoich. */
	userId: string;
	downloadFolder: string;
}

export const DEFAULT_SETTINGS: MarketplaceSettings = {
	apiBaseUrl: '',
	token: '',
	username: '',
	userId: '',
	downloadFolder: 'marketplace-downloads'
};

/**
 * Ostrzeżenie o niezaszyfrowanym połączeniu. Token nie wygasa i nie rotuje się,
 * więc podsłuchanie go raz na otwartym HTTP daje dostęp na zawsze. Localhost
 * jest w porządku - to domyślny tryb pracy z `wrangler dev`.
 */
function insecureUrlWarning(apiBaseUrl: string): string {
	const value = apiBaseUrl.trim();
	if (!value) return '';

	try {
		const url = new URL(value);
		const local = ['localhost', '127.0.0.1', '[::1]', '::1'];
		if (url.protocol === 'http:' && !local.includes(url.hostname)) {
			return 'Uwaga: adres używa http://, więc token leci przez sieć otwartym tekstem.';
		}
	} catch {
		// niedokończony adres w trakcie pisania - nie ma o czym ostrzegać
	}
	return '';
}

export class MarketplaceSettingTab extends PluginSettingTab {
	plugin: MarketplacePlugin;

	constructor(app: App, plugin: MarketplacePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderConnection(containerEl);

		new Setting(containerEl).setName('Konto').setHeading();
		if (this.plugin.settings.token) {
			this.renderLoggedIn(containerEl);
		} else {
			this.renderLoggedOut(containerEl);
		}

		new Setting(containerEl).setName('Pobieranie').setHeading();
		new Setting(containerEl)
			.setName('Folder pobierania')
			.setDesc('Folder, w którym lądują paczki pobrane z marketplace.')
			.addText((text) =>
				text.setValue(this.plugin.settings.downloadFolder).onChange(async (value) => {
					this.plugin.settings.downloadFolder = value;
					await this.plugin.saveSettings();
				}),
			);
	}

	private renderConnection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Połączenie').setHeading();

		const warning = insecureUrlWarning(this.plugin.settings.apiBaseUrl);
		const setting = new Setting(containerEl)
			.setName('Adres API')
			.setDesc('Bazowy URL serwera marketplace.')
			.addText((text) =>
				text
					.setPlaceholder('https://twoj-worker.workers.dev')
					.setValue(this.plugin.settings.apiBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.apiBaseUrl = value;
						await this.plugin.saveSettings();
					}),
			);

		// Ostrzeżenie liczymy tylko przy rysowaniu: przerysowanie w onChange
		// zabierałoby fokus z pola w trakcie pisania.
		if (warning) {
			setting.descEl.createDiv({ cls: 'marketplace-warning', text: warning });
		}
	}

	// --- stan bez tokenu ---

	private renderLoggedOut(containerEl: HTMLElement): void {
		let username = '';

		new Setting(containerEl)
			.setName('Załóż nowe konto')
			.setDesc('Od 3 do 32 znaków: litery, cyfry, podkreślnik, myślnik.')
			.addText((text) =>
				text.setPlaceholder('Nazwa użytkownika').onChange((value) => {
					username = value;
				}),
			)
			.addButton((button) =>
				button
					.setButtonText('Załóż konto')
					.setCta()
					.onClick(async () => {
						try {
							const account = await registerAccount(this.plugin.settings, username.trim());
							this.plugin.settings.token = account.token;
							await this.rememberIdentity(account);
							new Notice(
								`Konto ${account.username} utworzone. Token jest w polu poniżej — zapisz go, ` +
									'bo serwer nie pokaże go drugi raz.',
								0,
							);
							this.display();
						} catch (error) {
							new Notice(this.describe(error, 'Nie udało się założyć konta'));
						}
					}),
			);

		this.renderTokenField(containerEl, false);
	}

	// --- stan z tokenem ---

	private renderLoggedIn(containerEl: HTMLElement): void {
		const who = this.plugin.settings.username || '(nazwa nieznana)';

		new Setting(containerEl)
			.setName(`Zalogowany jako: ${who}`)
			.setDesc('Sprawdza, czy token nadal działa, i odświeża dane konta.')
			.addButton((button) =>
				button.setButtonText('Odśwież').onClick(async () => {
					try {
						const account = await fetchMe(this.plugin.settings);
						await this.rememberIdentity(account);
						new Notice(`Zalogowany jako ${account.username}. Tokenów na koncie: ${account.tokens}.`);
						this.display();
					} catch (error) {
						new Notice(this.describe(error, 'Błąd połączenia'));
					}
				}),
			);

		this.renderTokenField(containerEl, true);

		// Zwykłe wyjście: nic nie niszczy, więc stoi obok normalnych ustawień.
		new Setting(containerEl)
			.setName('Wyloguj z tego urządzenia')
			.setDesc('Usuwa token tylko stąd. Token zostaje ważny — wklej go, żeby wrócić na konto.')
			.addButton((button) =>
				button.setButtonText('Wyloguj').onClick(async () => {
					await this.forgetIdentity();
					new Notice('Wylogowano. Token nadal działa — wklej go, żeby wrócić.');
					this.display();
				}),
			);

		this.renderDangerZone(containerEl);
	}

	/** Akcje nieodwracalne trzymamy osobno, żeby nie stały obok codziennych. */
	private renderDangerZone(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Zaawansowane').setHeading();

		new Setting(containerEl)
			.setName('Token dla innego urządzenia')
			.setDesc('Wydaje dodatkowy token. Konto może mieć ich najwyżej 10.')
			.addButton((button) =>
				button.setButtonText('Wydaj nowy').onClick(async () => {
					try {
						const token = await createToken(this.plugin.settings, 'obsidian');
						// Ten token nigdzie się nie zapisuje, więc musi być widoczny na ekranie
						// nawet wtedy, gdy schowek zawiedzie.
						new Notice(`Nowy token — zapisz go teraz:\n${token}`, 0);
						await this.copy(token, 'Nowy token');
					} catch (error) {
						new Notice(this.describe(error, 'Nie udało się wydać tokenu'));
					}
				}),
			);

		new Setting(containerEl)
			.setName('Unieważnij ten token')
			.setDesc('Kasuje token na serwerze — użyj, gdy wyciekł. Jeśli to jedyny token konta, stracisz do niego dostęp.')
			.addButton((button) =>
				armButton(button, 'Unieważnij', 'Na pewno?', () => {
					void (async () => {
						try {
							await revokeToken(this.plugin.settings);
							new Notice('Token unieważniony');
						} catch (error) {
							console.error(error);
							new Notice('Nie udało się unieważnić na serwerze, usuwam lokalnie.');
						}
						// Czyścimy lokalnie także przy błędzie: inaczej w vaulcie zostałby
						// token, który użytkownik uważa za usunięty.
						await this.forgetIdentity();
						this.display();
					})();
				}),
			);

		new Setting(containerEl)
			.setName('Zamknij konto')
			.setDesc('Kasuje konto, jego tokeny i wszystkie opublikowane paczki. Tego nie da się cofnąć.')
			.addButton((button) =>
				armButton(button, 'Zamknij konto', 'Skasować wszystko?', () => {
					void (async () => {
						try {
							const removed = await closeAccount(this.plugin.settings);
							await this.forgetIdentity();
							new Notice(`Konto zamknięte. Usunięto paczek: ${removed}.`);
							this.display();
						} catch (error) {
							new Notice(this.describe(error, 'Nie udało się zamknąć konta'));
						}
					})();
				}),
			);
	}

	/**
	 * Pole tokenu.
	 *
	 * Uwaga: callback `addText()` wykonuje się synchronicznie w trakcie łańcucha,
	 * więc NIE wolno w nim sięgać po `const setting` — zmienna jeszcze nie istnieje
	 * i leci "Cannot access ... before initialization". Dlatego komponent zapamiętujemy
	 * w `input`, a przyciski dokładamy dopiero po domknięciu łańcucha.
	 */
	private renderTokenField(containerEl: HTMLElement, loggedIn: boolean): void {
		let input: TextComponent | null = null;

		const setting = new Setting(containerEl)
			.setName(loggedIn ? 'Twój token' : 'Mam już token')
			.setDesc(
				loggedIn
					? 'Zapisz go w bezpiecznym miejscu — bez niego nie wrócisz na konto. Leży otwartym tekstem w data.json wewnątrz vaulta.'
					: 'Wklej token, żeby wrócić na istniejące konto. Zaczyna się od omp_ i ma 68 znaków.',
			)
			.addText((text) => {
				input = text;
				text.inputEl.type = 'password'; // maskowanie w UI
				text
					.setPlaceholder('Wklej token')
					.setValue(this.plugin.settings.token)
					.onChange(async (value) => {
						const token = value.trim();
						this.plugin.settings.token = token;

						// Wklejenie innego tokenu unieważnia zapamiętaną tożsamość — inaczej
						// "Usuń" pokazywałoby się przy paczkach poprzedniego konta.
						if (!TOKEN_RE.test(token)) {
							this.plugin.settings.username = '';
							this.plugin.settings.userId = '';
						}
						await this.plugin.saveSettings();
					});
			});

		// Bez podglądu użytkownik nie ma jak zapisać własnego tokenu,
		// a bez zapisanego tokenu każde wylogowanie byłoby jednokierunkowe.
		setting.addExtraButton((extra) =>
			extra
				.setIcon('eye')
				.setTooltip('Pokaż lub ukryj token')
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
					.setTooltip('Kopiuj token do schowka')
					.onClick(() => void this.copy(this.plugin.settings.token, 'Token')),
			);
		} else {
			setting.addButton((button) =>
				button
					.setButtonText('Zaloguj')
					.setCta()
					.onClick(async () => {
						try {
							const account = await fetchMe(this.plugin.settings);
							await this.rememberIdentity(account);
							new Notice(`Zalogowany jako ${account.username}`);
							this.display();
						} catch (error) {
							new Notice(this.describe(error, 'Nie udało się zalogować'));
						}
					}),
			);
		}
	}

	// --- pomocnicze ---

	/** Serwer jest źródłem prawdy o tożsamości — lokalna kopia tylko za nim nadąża. */
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

	/** Schowek bywa niedostępny, a cicha porażka przy kopiowaniu tokenu boli. */
	private async copy(value: string, label: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(value);
			new Notice(`${label} skopiowany do schowka`);
		} catch {
			new Notice('Schowek niedostępny — skopiuj token ręcznie z pola (ikona oka pokazuje treść).');
		}
	}

	private describe(error: unknown, prefix: string): string {
		if (error instanceof UnauthorizedError) {
			return 'Serwer odrzucił token. Sprawdź, czy jest poprawny.';
		}
		return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
	}
}
