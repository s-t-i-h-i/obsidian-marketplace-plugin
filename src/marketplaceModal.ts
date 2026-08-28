import { ButtonComponent, Modal, Notice, Setting } from 'obsidian';
import MarketplacePlugin from './main';
import {
	Package,
	deletePackage,
	downloadPackageArchive,
	fetchPackage,
	fetchPackages,
} from './api/packagesApi';
import { installPackage } from './installs';
import { UnauthorizedError } from './api/api';
import { armButton } from './ui';

type SortKey = 'newest' | 'oldest' | 'title';

const SORT_LABELS: Record<SortKey, string> = {
	newest: 'Najnowsze',
	oldest: 'Najstarsze',
	title: 'Tytuł A-Z',
};

const ALL_TAGS = '';

/** Sprawdza konfigurację i otwiera bibliotekę paczek. */
export function openMarketplaceModal(plugin: MarketplacePlugin): void {
	if (!plugin.settings.apiBaseUrl.trim()) {
		new Notice('Ustaw adres API w ustawieniach pluginu');
		return;
	}

	new MarketplaceModal(plugin).open();
}

class MarketplaceModal extends Modal {
	private plugin: MarketplacePlugin;
	private bodyEl!: HTMLElement;

	private packages: Package[] = [];
	private tagFilter: string = ALL_TAGS;
	private sortBy: SortKey = 'newest';

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
			this.packages = await fetchPackages(this.plugin.settings);
			this.renderList();
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

	// --- widok listy ---

	private renderList() {
		this.bodyEl.empty();

		if (this.packages.length === 0) {
			this.renderMessage('Biblioteka jest pusta.');
			return;
		}

		this.renderToolbar();

		const visible = this.visiblePackages();
		if (visible.length === 0) {
			this.bodyEl.createDiv({ text: `Brak paczek z tagiem #${this.tagFilter}.` });
			return;
		}

		const grid = this.bodyEl.createDiv({ cls: 'marketplace-grid' });
		for (const pkg of visible) {
			this.renderCard(grid, pkg);
		}
	}

	private renderToolbar() {
		// Wszystkie tagi z katalogu, bez powtórzeń - filtr ma pokazywać to, co faktycznie istnieje.
		const tags = [...new Set(this.packages.flatMap((pkg) => pkg.tags))].sort((a, b) =>
			a.localeCompare(b, 'pl'),
		);

		new Setting(this.bodyEl)
			.setName('Tagi i kolejność')
			.addDropdown((dropdown) => {
				dropdown.addOption(ALL_TAGS, 'Wszystkie tagi');
				for (const tag of tags) {
					dropdown.addOption(tag, `#${tag}`);
				}
				dropdown.setValue(this.tagFilter).onChange((value) => {
					this.tagFilter = value;
					this.renderList();
				});
			})
			.addDropdown((dropdown) => {
				for (const [key, label] of Object.entries(SORT_LABELS)) {
					dropdown.addOption(key, label);
				}
				dropdown.setValue(this.sortBy).onChange((value) => {
					this.sortBy = value as SortKey;
					this.renderList();
				});
			});
	}

	/**
	 * Filtrowanie i sortowanie po stronie wtyczki - całą listę i tak mamy już
	 * w pamięci, więc pytanie serwera o to samo z parametrami byłoby zbędne.
	 */
	private visiblePackages(): Package[] {
		const filtered = this.tagFilter
			? this.packages.filter((pkg) => pkg.tags.includes(this.tagFilter))
			: [...this.packages];

		return filtered.sort((a, b) => {
			if (this.sortBy === 'title') return a.title.localeCompare(b.title, 'pl');
			// created_at to ISO-8601, więc zwykłe porównanie tekstów jest chronologiczne
			if (this.sortBy === 'oldest') return a.createdAt.localeCompare(b.createdAt);
			return b.createdAt.localeCompare(a.createdAt);
		});
	}

	/** Jeden kafelek. Kliknięcie w kafelek otwiera szczegóły. */
	private renderCard(grid: HTMLElement, pkg: Package) {
		const meta = [pkg.author, ...pkg.tags.map((tag) => `#${tag}`)]
			.filter((part) => part.length > 0)
			.join(' · ');

		const card = grid.createDiv({ cls: 'marketplace-card mod-clickable' });
		card.createDiv({ cls: 'marketplace-card-title', text: pkg.title });
		if (meta) card.createDiv({ cls: 'marketplace-card-meta', text: meta });
		if (pkg.description) {
			card.createDiv({ cls: 'marketplace-card-desc', text: pkg.description });
		}

		card.addEventListener('click', () => void this.showDetail(pkg));
	}

	// --- widok szczegółów ---

	private async showDetail(listed: Package) {
		this.renderMessage('Ładowanie szczegółów...');

		let pkg = listed;
		try {
			// lista nie niesie struktury, więc dociągamy pełny rekord
			pkg = await fetchPackage(this.plugin.settings, listed.id);
		} catch (error) {
			console.error(error);
			// brak struktury nie jest powodem, żeby nie pokazać reszty
			new Notice('Nie udało się pobrać struktury paczki');
		}

		this.bodyEl.empty();

		new ButtonComponent(this.bodyEl)
			.setButtonText('Wróć do listy')
			.onClick(() => this.renderList());

		const detail = this.bodyEl.createDiv({ cls: 'marketplace-detail' });
		detail.createEl('h3', { text: pkg.title });

		const meta = [pkg.author, formatDate(pkg.createdAt)].filter(Boolean).join(' · ');
		if (meta) detail.createDiv({ cls: 'marketplace-card-meta', text: meta });

		if (pkg.tags.length > 0) {
			const tagRow = detail.createDiv({ cls: 'marketplace-tags' });
			for (const tag of pkg.tags) {
				const chip = tagRow.createSpan({ cls: 'marketplace-tag', text: `#${tag}` });
				// kliknięcie w tag wraca do listy już przefiltrowanej
				chip.addEventListener('click', () => {
					this.tagFilter = tag;
					this.renderList();
				});
			}
		}

		detail.createEl('h4', { text: 'Opis' });
		detail.createDiv({
			cls: 'marketplace-detail-desc',
			text: pkg.description || 'Autor nie dodał opisu.',
		});

		detail.createEl('h4', { text: 'Zawartość' });
		this.renderStructure(detail, pkg.structure);

		const actions = detail.createDiv({ cls: 'marketplace-card-actions' });
		const download = new ButtonComponent(actions).setButtonText('Pobierz').setCta();
		download.onClick(() => void this.download(pkg, download));

		// Podpowiedź interfejsu, nie zabezpieczenie - właściciela sprawdza serwer.
		if (pkg.authorId && pkg.authorId === this.plugin.settings.userId) {
			armButton(new ButtonComponent(actions), 'Usuń', 'Na pewno?', () => {
				void this.remove(pkg);
			});
		}
	}

	private renderStructure(parent: HTMLElement, paths: string[]) {
		if (paths.length === 0) {
			parent.createDiv({
				cls: 'marketplace-tree-empty',
				text: 'Ta paczka została opublikowana zanim zapisywaliśmy strukturę folderów.',
			});
			return;
		}

		const tree = parent.createDiv({ cls: 'marketplace-tree' });
		renderNode(tree, buildTree(paths), 0);
		parent.createDiv({
			cls: 'marketplace-tree-count',
			text: `Plików: ${paths.length}`,
		});
	}

	// --- akcje ---

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
				'Błąd pobierania: ' + (error instanceof Error ? error.message : String(error)),
			);

			// nieudane pobranie nie może zabrać możliwości ponowienia
			button.setDisabled(false);
			button.setButtonText('Pobierz');
		}
	}

	private async remove(pkg: Package) {
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
					: 'Błąd usuwania: ' + (error instanceof Error ? error.message : String(error)),
			);
		}
	}
}

// --- drzewo plików ---

interface TreeNode {
	name: string;
	children: Map<string, TreeNode>;
	isFile: boolean;
}

/** Płaska lista ścieżek z ZIP-a -> zagnieżdżone drzewo do wyświetlenia. */
function buildTree(paths: string[]): TreeNode {
	const root: TreeNode = { name: '', children: new Map(), isFile: false };

	for (const path of paths) {
		const parts = path.split('/').filter((part) => part.length > 0);
		let node = root;

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i] as string;
			const isLast = i === parts.length - 1;

			let child = node.children.get(part);
			if (!child) {
				child = { name: part, children: new Map(), isFile: isLast };
				node.children.set(part, child);
			}
			node = child;
		}
	}

	return root;
}

function renderNode(parent: HTMLElement, node: TreeNode, depth: number) {
	// foldery przed plikami, potem alfabetycznie - tak samo jak w eksploratorze Obsidiana
	const children = [...node.children.values()].sort((a, b) => {
		if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
		return a.name.localeCompare(b.name, 'pl');
	});

	for (const child of children) {
		const row = parent.createDiv({ cls: 'marketplace-tree-row' });
		row.style.paddingLeft = `${depth * 16}px`;
		row.createSpan({
			cls: 'marketplace-tree-icon',
			text: child.isFile ? '📄' : '📁',
		});
		row.createSpan({ text: child.name });

		if (!child.isFile) renderNode(parent, child, depth + 1);
	}
}

/** ISO-8601 -> data w formacie lokalnym. Puste zostaje puste. */
function formatDate(iso: string): string {
	if (!iso) return '';
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pl-PL');
}
