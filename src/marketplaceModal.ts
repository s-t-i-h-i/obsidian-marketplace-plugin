import { ButtonComponent, Modal, Notice, Setting } from 'obsidian';
import MarketplacePlugin from './main';
import {
	Package,
	deletePackage,
	downloadPackageArchive,
	fetchPackage,
	fetchPackages,
} from './api/packagesApi';
import { inspectArchive, installPlan, formatBytes, type PackagePlan } from './installs';
import { UnauthorizedError } from './api/api';
import { armButton } from './ui';
import { renderFindings, renderConfirmRow } from './review';

type SortKey = 'newest' | 'oldest' | 'title';

const SORT_LABELS: Record<SortKey, string> = {
	newest: 'Newest',
	oldest: 'Oldest',
	title: 'Title A-Z',
};

const ALL_TAGS = '';

/** Otwiera bibliotekę paczek. Adres serwera jest wkompilowany, nie ma czego sprawdzać. */
export function openMarketplaceModal(plugin: MarketplacePlugin): void {
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
		contentEl.createEl('h2', { text: 'Package library' });
		// osobny kontener na treść: przerysowujemy tylko jego, nagłówek zostaje
		this.bodyEl = contentEl.createDiv();

		void this.load();
	}

	onClose() {
		this.contentEl.empty();
	}

	private async load() {
		this.renderMessage('Loading...');

		try {
			this.packages = await fetchPackages(this.plugin.settings);
			this.renderList();
		} catch (error) {
			console.error(error);
			const reason = error instanceof Error ? error.message : String(error);
			this.renderError(`Failed to fetch packages: ${reason}`);
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
			.setButtonText('Try again')
			.setCta()
			.onClick(() => void this.load());
	}

	// --- widok listy ---

	private renderList() {
		this.bodyEl.empty();

		if (this.packages.length === 0) {
			this.renderMessage('The library is empty.');
			return;
		}

		this.renderToolbar();

		const visible = this.visiblePackages();
		if (visible.length === 0) {
			this.bodyEl.createDiv({ text: `No packages with tag #${this.tagFilter}.` });
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
			a.localeCompare(b, 'en'),
		);

		new Setting(this.bodyEl)
			.setName('Tags and order')
			.addDropdown((dropdown) => {
				dropdown.addOption(ALL_TAGS, 'All tags');
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
			if (this.sortBy === 'title') return a.title.localeCompare(b.title, 'en');
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
		this.renderMessage('Loading details...');

		let pkg = listed;
		try {
			// lista nie niesie struktury, więc dociągamy pełny rekord
			pkg = await fetchPackage(this.plugin.settings, listed.id);
		} catch (error) {
			console.error(error);
			// brak struktury nie jest powodem, żeby nie pokazać reszty
			new Notice('Failed to fetch the package structure');
		}

		this.bodyEl.empty();

		new ButtonComponent(this.bodyEl)
			.setButtonText('Back to list')
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

		detail.createEl('h4', { text: 'Description' });
		detail.createDiv({
			cls: 'marketplace-detail-desc',
			text: pkg.description || 'The author did not add a description.',
		});

		detail.createEl('h4', { text: 'Contents' });
		this.renderStructure(detail, pkg.structure);

		const actions = detail.createDiv({ cls: 'marketplace-card-actions' });
		const download = new ButtonComponent(actions).setButtonText('Download').setCta();
		download.onClick(() => void this.download(pkg, download));

		// Podpowiedź interfejsu, nie zabezpieczenie - właściciela sprawdza serwer.
		if (pkg.authorId && pkg.authorId === this.plugin.settings.userId) {
			armButton(new ButtonComponent(actions), 'Delete', 'Are you sure?', () => {
				void this.remove(pkg);
			});
		}
	}

	private renderStructure(parent: HTMLElement, paths: string[]) {
		if (paths.length === 0) {
			parent.createDiv({
				cls: 'marketplace-tree-empty',
				text: 'This package was published before we started saving folder structure.',
			});
			return;
		}

		const tree = parent.createDiv({ cls: 'marketplace-tree' });
		renderNode(tree, buildTree(paths), 0);
		parent.createDiv({
			cls: 'marketplace-tree-count',
			text: `Files: ${paths.length}`,
		});
	}

	// --- akcje ---

	private async download(pkg: Package, button: ButtonComponent) {
		// blokada od razu: pobranie trwa, a trzy kliknięcia dałyby trzy kopie paczki
		button.setDisabled(true);
		button.setButtonText('Downloading...');

		try {
			const archive = await downloadPackageArchive(this.plugin.settings, pkg.id);
			// Sprawdzenie i zapis są rozdzielone, bo między nimi może stanąć pytanie
			// do użytkownika. Do tego momentu w vaulcie nie powstaje żaden plik.
			const plan = await inspectArchive(archive);

			if (plan.findings.length > 0) {
				this.confirmInstall(pkg, plan, button);
				return;
			}

			await this.write(pkg, plan, button);
		} catch (error) {
			this.failDownload(error, button);
		}
	}

	/**
	 * Pyta, zanim cudza aktywna treść trafi do vaulta.
	 *
	 * Paczka to notatki, które ktoś zaraz otworzy - a blok ```dataviewjs albo
	 * polecenie Templatera wykonuje się na uprawnieniach aplikacji. Użytkownik
	 * ma to zobaczyć przed zapisem, nie po.
	 */
	private confirmInstall(pkg: Package, plan: PackagePlan, button: ButtonComponent) {
		this.bodyEl.empty();
		this.bodyEl.createEl('h3', { text: `Review contents: ${pkg.title}` });
		this.bodyEl.createDiv({
			cls: 'marketplace-detail-desc',
			text:
				`This package has ${plan.files.length} files (${formatBytes(plan.totalBytes)}) and contains content ` +
				'that may execute or connect to the network when a note is opened. ' +
				'Only install from an author you trust.',
		});

		renderFindings(this.bodyEl, plan.findings);

		renderConfirmRow(
			this.bodyEl,
			'I understand, download anyway',
			() => void this.write(pkg, plan, button),
			() => void this.showDetail(pkg),
		);
	}

	/** Zapis do vaulta - jedyne miejsce, w którym powstają pliki. */
	private async write(pkg: Package, plan: PackagePlan, button: ButtonComponent) {
		try {
			const folder = await installPlan(
				this.app,
				plan,
				this.plugin.settings.downloadFolder,
				pkg.title,
			);

			new Notice(`Downloaded to: ${folder}`);
			void this.showDetail(pkg);
			// przycisk zostaje zablokowany - drugie kliknięcie zrobiłoby kopię
			// "Paczka 2", co niemal zawsze jest pomyłką, a nie zamiarem
			button.setButtonText('Downloaded');
		} catch (error) {
			this.failDownload(error, button);
		}
	}

	private failDownload(error: unknown, button: ButtonComponent) {
		// konsola dostaje pełny stack trace, user jedno czytelne zdanie
		console.error(error);
		new Notice('Download error: ' + (error instanceof Error ? error.message : String(error)));

		// nieudane pobranie nie może zabrać możliwości ponowienia
		button.setDisabled(false);
		button.setButtonText('Download');
	}

	private async remove(pkg: Package) {
		try {
			await deletePackage(this.plugin.settings, pkg.id);
			new Notice(`Deleted: ${pkg.title}`);
			// przeładowanie zamiast łatania listy na miejscu - widok ma pokazywać
			// stan serwera, a nie nasze wyobrażenie o nim
			void this.load();
		} catch (error) {
			console.error(error);
			new Notice(
				error instanceof UnauthorizedError
					? 'The server rejected the token. Check the plugin settings.'
					: 'Delete error: ' + (error instanceof Error ? error.message : String(error)),
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
		return a.name.localeCompare(b.name, 'en');
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
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US');
}
