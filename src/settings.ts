import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import MarketplacePlugin from './main';
import { TOKEN_RE, UnauthorizedError } from './api';
import { fetchMe, registerAccount, revokeToken } from './accountApi';

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

		new Setting(containerEl).setName('Połączenie').setHeading();

		const warning = insecureUrlWarning(this.plugin.settings.apiBaseUrl);
		const apiSetting = new Setting(containerEl)
			.setName('Adres API')
			.setDesc('Bazowy URL serwera, na który trafiają publikowane foldery.')
			.addText((text) =>
				text
					.setPlaceholder('https://twoj-worker.workers.dev')
					.setValue(this.plugin.settings.apiBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.apiBaseUrl = value;
						await this.plugin.saveSettings();
					}),
			);

		// Ostrzeżenie liczymy tylko przy rysowaniu: onChange przerysowałby zakładkę
		// w trakcie pisania i zabrałby fokus z pola.
		if (warning) {
			apiSetting.descEl.createDiv({ cls: 'marketplace-warning', text: warning });
		}

		new Setting(containerEl).setName('Konto').setHeading();

		if (this.plugin.settings.token) {
			this.renderLoggedIn(containerEl);
		} else {
			this.renderRegister(containerEl);
		}

		this.renderTokenField(containerEl);

		new Setting(containerEl).setName('Pobieranie').setHeading();

		new Setting(containerEl)
			.setName('Folder pobierania')
			.setDesc('Folder, w którym lądują paczki pobrane z marketplace.')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.downloadFolder)
					.onChange(async (value) => {
						this.plugin.settings.downloadFolder = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	/** Stan bez tokenu: zakładanie konta. */
	private renderRegister(containerEl: HTMLElement): void {
		let username = '';

		new Setting(containerEl)
			.setName('Załóż konto')
			.setDesc('Od 3 do 32 znaków: litery, cyfry, podkreślnik, myślnik.')
			.addText((text) =>
				text.setPlaceholder('Nazwa użytkownika').onChange((value) => {
					username = value;
				}),
			)
			.addButton((button) =>
				button
					.setButtonText('Rejestruj')
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						try {
							const account = await registerAccount(
								this.plugin.settings,
								username.trim(),
							);

							this.plugin.settings.token = account.token;
							this.plugin.settings.username = account.username;
							this.plugin.settings.userId = account.userId;
							await this.plugin.saveSettings();

							new Notice(
								`Konto ${account.username} utworzone. Zapisz token - nie da się go odzyskać.`,
							);
							this.display();
						} catch (error) {
							button.setDisabled(false);
							new Notice(
								'Nie udało się założyć konta: ' +
									(error instanceof Error ? error.message : String(error)),
							);
						}
					}),
			);
	}

	/** Stan z tokenem: weryfikacja i wylogowanie. */
	private renderLoggedIn(containerEl: HTMLElement): void {
		const who = this.plugin.settings.username || '(nazwa nieznana)';

		new Setting(containerEl)
			.setName('Sprawdź połączenie')
			.setDesc(`Zalogowany jako: ${who}`)
			.addButton((button) =>
				button.setButtonText('Testuj').onClick(async () => {
					try {
						const account = await fetchMe(this.plugin.settings);

						// Serwer jest źródłem prawdy - odświeżamy lokalną kopię,
						// żeby przycisk "Usuń" trafiał we właściwe paczki.
						this.plugin.settings.username = account.username;
						this.plugin.settings.userId = account.userId;
						await this.plugin.saveSettings();

						new Notice(`Zalogowany jako ${account.username}`);
						this.display();
					} catch (error) {
						new Notice(
							error instanceof UnauthorizedError
								? 'Serwer odrzucił token. Zaloguj się ponownie.'
								: 'Błąd połączenia: ' +
										(error instanceof Error ? error.message : String(error)),
						);
					}
				}),
			);

		new Setting(containerEl)
			.setName('Wyloguj')
			.setDesc('Unieważnia token na serwerze i usuwa go z tego urządzenia.')
			.addButton((button) =>
				button
					.setButtonText('Wyloguj')
					.setWarning()
					.onClick(async () => {
						try {
							await revokeToken(this.plugin.settings);
							new Notice('Token unieważniony');
						} catch (error) {
							// Czyścimy lokalnie także przy błędzie: inaczej nieudane
							// żądanie zostawiłoby w vaulcie token, który użytkownik
							// uważa za usunięty.
							console.error(error);
							new Notice('Nie udało się unieważnić tokenu na serwerze, usuwam lokalnie.');
						}

						this.plugin.settings.token = '';
						this.plugin.settings.username = '';
						this.plugin.settings.userId = '';
						await this.plugin.saveSettings();
						this.display();
					}),
			);
	}

	private renderTokenField(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Token')
			.setDesc(
				'Zaczyna się od omp_ i ma 68 znaków. Zapisywany otwartym tekstem w data.json ' +
					'wewnątrz vaulta: nie commituj go do gita i pamiętaj, że synchronizacja vaulta ' +
					'kopiuje go razem z notatkami. Po wycieku użyj „Wyloguj".',
			)
			.addText((text) => {
				text.inputEl.type = 'password'; // maskowanie w UI
				text
					.setPlaceholder('Wklej token')
					.setValue(this.plugin.settings.token)
					.onChange(async (value) => {
						const token = value.trim();
						this.plugin.settings.token = token;

						// Wklejenie cudzego/innego tokenu unieważnia zapamiętaną tożsamość -
						// inaczej "Usuń" pokazywałoby się przy paczkach poprzedniego konta.
						if (!TOKEN_RE.test(token)) {
							this.plugin.settings.username = '';
							this.plugin.settings.userId = '';
						}

						await this.plugin.saveSettings();
					});
			});
	}
}
