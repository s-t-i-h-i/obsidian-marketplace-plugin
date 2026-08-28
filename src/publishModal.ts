import { ButtonComponent, Modal, Notice, Setting, TFile, TFolder } from 'obsidian';
import MarketplacePlugin from './main';
import { collectFiles, findBrokenLinks } from './files';
import { publishFolder } from './publishApi';

type FieldKey = 'title' | 'description' | 'author' | 'tags';

const FIELDS: { key: FieldKey; name: string; desc?: string; multiline?: boolean }[] = [
	{ key: 'title', name: 'Tytuł' },
	{ key: 'description', name: 'Opis', multiline: true },
	{ key: 'author', name: 'Autor' },
	{ key: 'tags', name: 'Tagi', desc: 'Oddzielone przecinkami' },
];

/** Sprawdza folder i otwiera formularz publikacji tylko gdy nie ma uszkodzonych linków. */
export function openPublishModal(plugin: MarketplacePlugin, folder: TFolder): void {
	const files = collectFiles(folder);
	if (files.length === 0) {
		new Notice('Brak plików do opublikowania');
		return;
	}

	const brokenLinks = findBrokenLinks(plugin.app, files);
	if (brokenLinks.length > 0) {
		const details = brokenLinks
			.map((link) => `${link.source} → ${link.target}`)
			.join('\n');
		new Notice(`Znaleziono ${brokenLinks.length} uszkodzonych linków:\n${details}`);
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

	constructor(plugin: MarketplacePlugin, folder: TFolder, files: TFile[]) {
		super(plugin.app);
		this.plugin = plugin;
		this.folder = folder;
		this.files = files;
		this.values = {
			title: folder.name,
			description: '',
			author: plugin.settings.defaultAuthor,
			tags: '',
		};
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: `Publikuj: ${this.folder.name}` });

		for (const field of FIELDS) {
			const setting = new Setting(contentEl).setName(field.name);
			if (field.desc) setting.setDesc(field.desc);

			const value = this.values[field.key];
			const onChange = (next: string) => (this.values[field.key] = next);

			if (field.multiline) {
				setting.addTextArea((text) => text.setValue(value).onChange(onChange));
			} else {
				setting.addText((text) => text.setValue(value).onChange(onChange));
			}
		}

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Publikuj')
				.setCta()
				.onClick(() => void this.publish(button)),
		);
	}

	private async publish(button: ButtonComponent) {
		const title = this.values.title.trim();
		const author = this.values.author.trim();
		const apiBaseUrl = this.plugin.settings.apiBaseUrl.trim();

		if (!title || !author) {
			new Notice('Tytuł i autor są wymagane');
			return;
		}
		if (!apiBaseUrl) {
			new Notice('Ustaw adres API w ustawieniach pluginu');
			return;
		}

		// setDisabled() wymaga Obsidian 1.2.3, buttonEl działa na każdej wersji
		button.buttonEl.disabled = true;
		button.setButtonText('Publikowanie...');

		try {
			await publishFolder(
				this.app,
				this.folder,
				this.files,
				{
					title,
					author,
					description: this.values.description.trim(),
					tags: this.values.tags
						.split(',')
						.map((tag) => tag.trim())
						.filter((tag) => tag.length > 0),
				},
				apiBaseUrl,
			);

			new Notice('Opublikowano');
			this.close();
		} catch (error) {
			console.error(error);
			new Notice(
				'Błąd publikacji: ' +
					(error instanceof Error ? error.message : String(error)),
			);
			button.buttonEl.disabled = false;
			button.setButtonText('Publikuj');
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
