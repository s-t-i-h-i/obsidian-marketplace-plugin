import { ButtonComponent, Modal, Notice } from 'obsidian';
import MarketplacePlugin from './main';
import { Package, deletePackage, downloadPackageArchive, fetchPackages } from './packagesApi';
import { installPackage } from './installs';
import { UnauthorizedError } from './api';

/** Sprawdza konfigurację i otwiera bibliotekę paczek. */
export function openMarketplaceModal(plugin: MarketplacePlugin): void {
	const apiBaseUrl = plugin.settings.apiBaseUrl.trim();
	if (!apiBaseUrl) {
		new Notice('Ustaw adres API w ustawieniach pluginu');
		return;
	}

	new MarketplaceModal(plugin).open();
}

class MarketplaceModal extends Modal {
	private plugin: MarketplacePlugin;
	private bodyEl!: HTMLElement;

	constructor(plugin: MarketplacePlugin) {
		super(plugin.app);
		// super() zużywa plugin i go gubi, a ustawienia są potrzebne przy pobieraniu
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Biblioteka paczek' });
		// osobny kontener na treść: przerysowujemy tylko jego, nagłówek zostaje
		this.bodyEl = contentEl.createDiv();

		void this.load();
	}

	onClose() {
		this.contentEl.empty();
	}

	private async load() {
		this.renderMessage('Ładowanie...');

		try {
			const packages = await fetchPackages(this.plugin.settings);
			this.renderPackages(packages);
		} catch (error) {
			console.error(error);
			const reason = error instanceof Error ? error.message : String(error);
			this.renderError(`Nie udało się pobrać paczek: ${reason}`);
		}
	}

	/** Prosty komunikat na środku - używany przy ładowaniu i pustej bibliotece. */
	private renderMessage(text: string) {
		this.bodyEl.empty();
		this.bodyEl.createDiv({ text });
	}

	/** Komunikat błędu z możliwością ponowienia - sieć bywa kapryśna. */
	private renderError(text: string) {
		this.renderMessage(text);
		new ButtonComponent(this.bodyEl)
			.setButtonText('Spróbuj ponownie')
			.setCta()
			.onClick(() => void this.load());
	}

	private renderPackages(packages: Package[]) {
		if (packages.length === 0) {
			this.renderMessage('Biblioteka jest pusta.');
			return;
		}

		this.bodyEl.empty();
		const grid = this.bodyEl.createDiv({ cls: 'marketplace-grid' });
		for (const pkg of packages) {
			this.renderPackage(grid, pkg);
		}
	}

	/** Jedna paczka = jeden kafelek, stylowany przez styles.css. */
	private renderPackage(grid: HTMLElement, pkg: Package) {
		const meta = [pkg.author, ...pkg.tags.map((tag) => `#${tag}`)]
			.filter((part) => part.length > 0)
			.join(' · ');

		const card = grid.createDiv({ cls: 'marketplace-card' });
		card.createDiv({ cls: 'marketplace-card-title', text: pkg.title });
		if (meta) card.createDiv({ cls: 'marketplace-card-meta', text: meta });
		if (pkg.description) {
			card.createDiv({ cls: 'marketplace-card-desc', text: pkg.description });
		}
		// przycisk trzymamy w zmiennej, bo callback potrzebuje referencji do
		// komponentu, którego łańcuch jeszcze nie zdążył zwrócić
		const actions = card.createDiv({ cls: 'marketplace-card-actions' });
		const button = new ButtonComponent(actions).setButtonText('Pobierz').setCta();
		button.onClick(() => void this.download(pkg, button));

		// Podpowiedź interfejsu, nie zabezpieczenie - właściciela sprawdza serwer.
		// Paczki zastane mają puste authorId, więc nie pokażą przycisku nikomu.
		if (pkg.authorId && pkg.authorId === this.plugin.settings.userId) {
			this.renderDeleteButton(actions, pkg);
		}
	}

	/**
	 * Kasowanie jest nieodwracalne, a Obsidian nie ma wbudowanego okna potwierdzenia,
	 * więc pytamy w miejscu: pierwsze kliknięcie uzbraja, drugie kasuje.
	 */
	private renderDeleteButton(actions: HTMLElement, pkg: Package) {
		const button = new ButtonComponent(actions).setButtonText('Usuń');
		let armed = false;

		button.onClick(() => {
			if (armed) {
				void this.remove(pkg, button);
				return;
			}

			armed = true;
			button.setWarning().setButtonText('Na pewno?');

			// Uzbrojony na zawsze przycisk kasowania to pułapka, więc się rozbraja.
			window.setTimeout(() => {
				if (!button.buttonEl.isConnected) return;
				armed = false;
				button.buttonEl.removeClass('mod-warning');
				button.setButtonText('Usuń');
			}, 4000);
		});
	}

	private async remove(pkg: Package, button: ButtonComponent) {
		button.setDisabled(true);
		button.setButtonText('Usuwanie...');

		try {
			await deletePackage(this.plugin.settings, pkg.id);
			new Notice(`Usunięto: ${pkg.title}`);
			// przeładowanie zamiast łatania listy na miejscu - widok ma pokazywać
			// stan serwera, a nie nasze wyobrażenie o nim
			void this.load();
		} catch (error) {
			console.error(error);
			new Notice(
				error instanceof UnauthorizedError
					? 'Serwer odrzucił token. Sprawdź ustawienia pluginu.'
					: 'Błąd usuwania: ' +
							(error instanceof Error ? error.message : String(error)),
			);
			button.setDisabled(false);
			button.buttonEl.removeClass('mod-warning');
			button.setButtonText('Usuń');
		}
	}

	/** Pobiera archiwum paczki i rozpakowuje je do nowego folderu w vaulcie. */
	private async download(pkg: Package, button: ButtonComponent) {
		// blokada od razu: pobranie trwa, a trzy kliknięcia dałyby trzy kopie paczki
		button.setDisabled(true);
		button.setButtonText('Pobieranie...');

		try {
			const archive = await downloadPackageArchive(this.plugin.settings, pkg.id);
			const folder = await installPackage(
				this.app,
				archive,
				this.plugin.settings.downloadFolder,
				pkg.title,
			);

			new Notice(`Pobrano do: ${folder}`);
			// przycisk zostaje zablokowany - drugie kliknięcie zrobiłoby kopię
			// "Paczka 2", co niemal zawsze jest pomyłką, a nie zamiarem
			button.setButtonText('Pobrano');
		} catch (error) {
			// konsola dostaje pełny stack trace, user jedno czytelne zdanie
			console.error(error);
			new Notice(
				'Błąd pobierania: ' +
					(error instanceof Error ? error.message : String(error)),
			);

			// nieudane pobranie nie może zabrać możliwości ponowienia
			button.setDisabled(false);
			button.setButtonText('Pobierz');
		}
	}
}
