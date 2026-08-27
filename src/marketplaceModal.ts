import { ButtonComponent, Modal, Notice } from 'obsidian';
import MarketplacePlugin from './main';
import { Course, downloadCourseArchive, fetchCourses } from './coursesApi';
import { installCourse } from './installs';

/** Sprawdza konfigurację i otwiera bibliotekę kursów. */
export function openMarketplaceModal(plugin: MarketplacePlugin): void {
	const apiBaseUrl = plugin.settings.apiBaseUrl.trim();
	if (!apiBaseUrl) {
		new Notice('Ustaw adres API w ustawieniach pluginu');
		return;
	}

	new MarketplaceModal(plugin, apiBaseUrl).open();
}

class MarketplaceModal extends Modal {
	private plugin: MarketplacePlugin;
	private apiBaseUrl: string;
	private bodyEl!: HTMLElement;

	constructor(plugin: MarketplacePlugin, apiBaseUrl: string) {
		super(plugin.app);
		// super() zużywa plugin i go gubi, a ustawienia są potrzebne przy pobieraniu
		this.plugin = plugin;
		this.apiBaseUrl = apiBaseUrl;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Biblioteka kursów' });
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
			const courses = await fetchCourses(this.apiBaseUrl);
			this.renderCourses(courses);
		} catch (error) {
			console.error(error);
			const reason = error instanceof Error ? error.message : String(error);
			this.renderError(`Nie udało się pobrać kursów: ${reason}`);
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

	private renderCourses(courses: Course[]) {
		if (courses.length === 0) {
			this.renderMessage('Biblioteka jest pusta.');
			return;
		}

		this.bodyEl.empty();
		const grid = this.bodyEl.createDiv({ cls: 'marketplace-grid' });
		for (const course of courses) {
			this.renderCourse(grid, course);
		}
	}

	/** Jeden kurs = jeden kafelek, stylowany przez styles.css. */
	private renderCourse(grid: HTMLElement, course: Course) {
		const meta = [course.author, ...course.tags.map((tag) => `#${tag}`)]
			.filter((part) => part.length > 0)
			.join(' · ');

		const card = grid.createDiv({ cls: 'marketplace-card' });
		card.createDiv({ cls: 'marketplace-card-title', text: course.title });
		if (meta) card.createDiv({ cls: 'marketplace-card-meta', text: meta });
		if (course.description) {
			card.createDiv({ cls: 'marketplace-card-desc', text: course.description });
		}
		// przycisk trzymamy w zmiennej, bo callback potrzebuje referencji do
		// komponentu, którego łańcuch jeszcze nie zdążył zwrócić
		const actions = card.createDiv({ cls: 'marketplace-card-actions' });
		const button = new ButtonComponent(actions).setButtonText('Pobierz').setCta();
		button.onClick(() => void this.download(course, button));
	}

	/** Pobiera archiwum kursu i rozpakowuje je do nowego folderu w vaulcie. */
	private async download(course: Course, button: ButtonComponent) {
		// blokada od razu: pobranie trwa, a trzy kliknięcia dałyby trzy kopie kursu
		button.setDisabled(true);
		button.setButtonText('Pobieranie...');

		try {
			const archive = await downloadCourseArchive(this.apiBaseUrl, course.id);
			const folder = await installCourse(
				this.app,
				archive,
				this.plugin.settings.downloadFolder,
				course.title,
			);

			new Notice(`Pobrano do: ${folder}`);
			// przycisk zostaje zablokowany - drugie kliknięcie zrobiłoby kopię
			// "Kurs 2", co niemal zawsze jest pomyłką, a nie zamiarem
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
