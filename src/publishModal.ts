import { ButtonComponent, Modal, Notice, Setting, TFile, TFolder } from 'obsidian';
import MarketplacePlugin from './main';
import { collectFiles, findBrokenLinks, type BrokenLink } from './files';
import { publishFolder } from './api/publishApi';
import { UnauthorizedError } from './api/api';
import { isScannable, scanContent, type Finding } from './scan';
import { formatBytes } from './installs';
import { renderFindings, renderConfirmRow } from './review';

type FieldKey = 'title' | 'description' | 'tags';

const FIELDS: { key: FieldKey; name: string; desc?: string; multiline?: boolean }[] = [
	{ key: 'title', name: 'Tytuł' },
	{ key: 'description', name: 'Opis', multiline: true },
	{ key: 'tags', name: 'Tagi', desc: 'Oddzielone przecinkami' },
];

/** Ile problemów wypisujemy, zanim lista przestaje być czytelna. */
const MAX_LISTED = 20;

/** Sprawdza konfigurację i folder, i otwiera formularz tylko gdy publikacja ma szansę się udać. */
export function openPublishModal(plugin: MarketplacePlugin, folder: TFolder): void {
	// Bramki idą przed zbieraniem plików: kazanie użytkownikowi wypełnić formularz,
	// żeby dopiero potem powiedzieć mu "zaloguj się", to zła kolejność - a przy okazji
	// nie ma po co przechodzić drzewa folderów.
	if (!plugin.settings.token.trim()) {
		new Notice('Zaloguj się w ustawieniach pluginu, żeby publikować');
		return;
	}

	const files = collectFiles(folder);
	if (files.length === 0) {
		new Notice('Brak plików do opublikowania');
		return;
	}

	// lista jedzie dalej do modala, żeby nie liczyć jej drugi raz przy pakowaniu
	new PublishModal(plugin, folder, files).open();
}

class PublishModal extends Modal {
	//private oznacza pole widoczne tylko wewnątrz klasy
	private plugin: MarketplacePlugin;
	private folder: TFolder;
	private files: TFile[];
	private values: Record<FieldKey, string>;
	private bodyEl!: HTMLElement;

	constructor(plugin: MarketplacePlugin, folder: TFolder, files: TFile[]) {
		super(plugin.app);
		this.plugin = plugin;
		this.folder = folder;
		this.files = files;
		this.values = {
			title: folder.name,
			description: '',
			tags: '',
		};
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: `Publikuj: ${this.folder.name}` });
		this.bodyEl = contentEl.createDiv();

		void this.review();
	}

	/**
	 * Ekran kontrolny przed formularzem.
	 *
	 * Publikowanie wynosi treść z prywatnego vaulta do publicznego katalogu, i to
	 * jest operacja nieodwracalna w tym sensie, że raz pobranej paczki nikt już nie
	 * cofnie. Autor ma najpierw zobaczyć, CO wysyła.
	 */
	private async review() {
		this.bodyEl.empty();
		this.bodyEl.createDiv({ text: 'Sprawdzanie zawartości...' });

		const links = findBrokenLinks(this.app, this.files);
		const findings = await this.scanFiles();
		const bytes = this.files.reduce((sum, file) => sum + file.stat.size, 0);

		this.bodyEl.empty();

		// Liczba plików i rozmiar na wierzchu: "Publikuj" na korzeniu vaulta
		// wysyłałoby wszystko, a bez tej informacji nikt by się nie zorientował.
		this.bodyEl.createDiv({
			cls: 'marketplace-detail-desc',
			text: `Do wysłania: ${this.files.length} plików, ${formatBytes(bytes)}.`,
		});

		if (links.length === 0 && findings.length === 0) {
			this.renderForm();
			return;
		}

		if (links.length > 0) this.renderLinks(links);
		if (findings.length > 0) {
			this.bodyEl.createDiv({
				cls: 'marketplace-detail-desc',
				text: 'Ta treść wykona się albo połączy z siecią u każdego, kto pobierze paczkę:',
			});
			renderFindings(this.bodyEl, findings);
		}

		// Wcześniej uszkodzone linki blokowały publikację całkowicie, przez Notice
		// z całą listą sklejoną w jeden napis. To jest ostrzeżenie, a nie błąd -
		// paczka bywa świadomie niekompletna, a decyzja należy do autora.
		renderConfirmRow(
			this.bodyEl,
			'Publikuj mimo to',
			() => this.renderForm(),
			() => this.close(),
		);
	}

	/** Czyta pliki tekstowe paczki i szuka w nich aktywnej treści. */
	private async scanFiles(): Promise<Finding[]> {
		const findings: Finding[] = [];

		for (const file of this.files) {
			if (!isScannable(file.path)) continue;
			// cachedRead, nie read: to tylko odczyt do analizy
			findings.push(...scanContent(file.path, await this.app.vault.cachedRead(file)));
		}

		return findings;
	}

	private renderLinks(links: BrokenLink[]) {
		const outside = links.filter((link) => link.problem === 'outside');
		const unresolved = links.filter((link) => link.problem === 'unresolved');

		if (outside.length > 0) {
			this.renderLinkGroup(
				`Linki poza paczkę (${outside.length})`,
				'Cel istnieje w Twoim vaulcie, ale nie wchodzi do paczki - u odbiorcy link będzie martwy.',
				outside,
			);
		}
		if (unresolved.length > 0) {
			this.renderLinkGroup(
				`Linki donikąd (${unresolved.length})`,
				'Te linki nie prowadzą do niczego już u Ciebie.',
				unresolved,
			);
		}
	}

	private renderLinkGroup(title: string, desc: string, links: BrokenLink[]) {
		this.bodyEl.createEl('h4', { text: title });
		this.bodyEl.createDiv({ cls: 'marketplace-finding-path', text: desc });

		const list = this.bodyEl.createDiv({ cls: 'marketplace-findings' });
		for (const link of links.slice(0, MAX_LISTED)) {
			const row = list.createDiv({ cls: 'marketplace-finding marketplace-finding-warning' });
			row.createDiv({ cls: 'marketplace-finding-label', text: link.target });
			row.createDiv({ cls: 'marketplace-finding-path', text: `w: ${link.source}` });
		}
		if (links.length > MAX_LISTED) {
			list.createDiv({
				cls: 'marketplace-finding-path',
				text: `...i jeszcze ${links.length - MAX_LISTED}.`,
			});
		}
	}

	private renderForm() {
		this.bodyEl.empty();

		for (const field of FIELDS) {
			const setting = new Setting(this.bodyEl).setName(field.name);
			if (field.desc) setting.setDesc(field.desc);

			const value = this.values[field.key];
			const onChange = (next: string) => (this.values[field.key] = next);

			if (field.multiline) {
				setting.addTextArea((text) => text.setValue(value).onChange(onChange));
			} else {
				setting.addText((text) => text.setValue(value).onChange(onChange));
			}
		}

		new Setting(this.bodyEl).addButton((button) =>
			button
				.setButtonText('Publikuj')
				.setCta()
				.onClick(() => void this.publish(button)),
		);
	}

	private async publish(button: ButtonComponent) {
		const title = this.values.title.trim();

		if (!title) {
			new Notice('Tytuł jest wymagany');
			return;
		}

		button.setDisabled(true);
		button.setButtonText('Publikowanie...');

		try {
			await publishFolder(
				this.app,
				this.folder,
				this.files,
				{
					title,
					description: this.values.description.trim(),
					tags: this.values.tags
						.split(',')
						.map((tag) => tag.trim())
						.filter((tag) => tag.length > 0),
				},
				this.plugin.settings,
			);

			new Notice('Opublikowano');
			this.close();
		} catch (error) {
			console.error(error);
			// Token mógł zostać unieważniony między otwarciem modala a kliknięciem,
			// więc podpowiadamy ustawienia zamiast pokazywać gołe "401".
			new Notice(
				error instanceof UnauthorizedError
					? 'Serwer odrzucił token. Sprawdź ustawienia pluginu.'
					: 'Błąd publikacji: ' +
							(error instanceof Error ? error.message : String(error)),
			);
			button.setDisabled(false);
			button.setButtonText('Publikuj');
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
