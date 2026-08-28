import { App, normalizePath } from 'obsidian';
import JSZip from 'jszip';
import { DEFAULT_SETTINGS } from './settings';

/**
 * Znaki, których nie wolno wpuścić do nazwy folderu.
 *
 * Pierwsza grupa (\ / : * ? " < > |) odpadłaby na poziomie systemu plików,
 * druga (# ^ [ ]) przeszłaby, ale psułaby składnię linków w Obsidianie.
 */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

/** Ile razy dopisujemy numer do zajętej nazwy, zanim się poddamy. */
const MAX_NAME_ATTEMPTS = 100;

/** Wpis z archiwum, którego ścieżka przeszła już walidację. */
interface PlannedFile {
	/** Ścieżka względem folderu paczki, np. "obrazki/schemat.png". */
	path: string;
	entry: JSZip.JSZipObject;
}

/**
 * Rozpakowuje archiwum paczki do nowego folderu w vaulcie.
 *
 * Zwraca ścieżkę utworzonego folderu - wywołujący używa jej do komunikatu
 * i do otwarcia pobranej notatki.
 */
export async function installPackage(
	app: App,
	archive: ArrayBuffer,
	baseFolder: string,
	packageTitle: string,
): Promise<string> {
	const zip = await JSZip.loadAsync(archive);

	// Całe archiwum sprawdzamy, zanim zapiszemy pierwszy bajt. Walidacja to
	// same operacje na stringach, a daje gwarancję "albo cała paczka, albo nic".
	const files = planFiles(zip);
	if (files.length === 0) {
		throw new Error('Archiwum nie zawiera żadnych plików');
	}

	const root = await createPackageFolder(app, baseFolder, packageTitle);

	try {
		await writeFiles(app, root, files);
	} catch (error) {
		// pół paczki w vaulcie jest gorsze niż brak paczki
		await rollback(app, root);
		throw error;
	}

	return root;
}

/**
 * Zamienia wpisy archiwum na listę plików do zapisania.
 *
 * Rzuca wyjątkiem przy pierwszej podejrzanej ścieżce - świadomie przerywamy
 * całe archiwum zamiast po cichu pomijać pojedynczy wpis. Paczka ze ścieżką
 * uciekającą poza folder docelowy to atak, a nie literówka autora.
 */
function planFiles(zip: JSZip): PlannedFile[] {
	const files: PlannedFile[] = [];

	for (const entry of Object.values(zip.files)) {
		// foldery odtwarzamy ze ścieżek plików - ZIP wcale nie musi zawierać
		// wpisów katalogowych, więc i tak nie można na nich polegać
		if (entry.dir) continue;

		files.push({ path: safeRelativePath(entry.name), entry });
	}

	return files;
}

/**
 * Sprawdza, czy ścieżka z archiwum zostanie wewnątrz folderu paczki.
 *
 * Jeden przebieg po segmentach łapie wszystkie warianty ucieczki naraz:
 * ".." wychodzi poziom wyżej, pusty segment oznacza wiodący ukośnik
 * (czyli ścieżkę absolutną) albo "//" w środku, a "." tylko zaśmieca ścieżkę.
 */
function safeRelativePath(name: string): string {
	// niektóre archiwizatory zapisują separator windowsowy; nie chcemy zgadywać,
	// czy "a\b.md" to jeden plik z ukośnikiem w nazwie, czy dwa poziomy
	if (name.includes('\\')) {
		throw new Error(`Niedozwolona ścieżka w archiwum: ${name}`);
	}

	const segments = name.split('/');
	for (const segment of segments) {
		if (segment === '' || segment === '.' || segment === '..') {
			throw new Error(`Niedozwolona ścieżka w archiwum: ${name}`);
		}
	}

	return segments.join('/');
}

/** Tworzy pusty folder na paczkę i zwraca jego ścieżkę. */
async function createPackageFolder(
	app: App,
	baseFolder: string,
	packageTitle: string,
): Promise<string> {
	// puste pole w ustawieniach nie może znaczyć "wysyp paczkę do korzenia vaulta"
	const base = normalizePath(baseFolder.trim() || DEFAULT_SETTINGS.downloadFolder);
	assertInsideVault(base);

	const folders = new Set<string>();
	await ensureFolder(app, base, folders);

	const name = toFolderName(packageTitle);
	for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
		// "Paczka", "Paczka 2", "Paczka 3"... - pobranie tej samej paczki drugi raz
		// ma dać drugi folder, a nie błąd
		const suffix = attempt === 1 ? '' : ` ${attempt}`;
		const path = normalizePath(`${base}/${name}${suffix}`);

		if (app.vault.getAbstractFileByPath(path) === null) {
			await app.vault.createFolder(path);
			return path;
		}
	}

	throw new Error(`Nie znaleziono wolnej nazwy folderu dla "${packageTitle}"`);
}

/**
 * Robi z tytułu paczki nazwę folderu.
 *
 * Tytuł wpisał człowiek w formularzu publikacji, więc może zawierać cokolwiek -
 * łącznie ze znakami, które rozwalają ścieżkę albo tworzą folder ukryty.
 */
function toFolderName(title: string): string {
	const name = title
		.replace(ILLEGAL_NAME_CHARS, '-')
		// wiodąca kropka ukrywa folder przed Obsidianem, końcowa psuje ścieżki na Windowsie
		.replace(/^[.\s]+|[.\s]+$/g, '');

	return name || 'paczka';
}

/** normalizePath() czyści ukośniki, ale zostawia ".." - a to wyprowadza poza vault. */
function assertInsideVault(path: string): void {
	if (path.split('/').some((segment) => segment === '..')) {
		throw new Error(`Niedozwolony folder docelowy: ${path}`);
	}
}

/** Zapisuje zaplanowane pliki, tworząc po drodze brakujące podfoldery. */
async function writeFiles(app: App, root: string, files: PlannedFile[]): Promise<void> {
	// pamięć o utworzonych folderach: createFolder() rzuca, gdy folder istnieje,
	// a kolejne pliki z tego samego podfolderu trafiałyby tu w kółko
	const folders = new Set<string>([root]);

	for (const file of files) {
		const path = `${root}/${file.path}`;
		await ensureFolder(app, path.slice(0, path.lastIndexOf('/')), folders);

		// createBinary() zapisuje surowe bajty, więc obsługuje i .md, i obrazki -
		// jedna ścieżka kodu zamiast rozgałęziania po rozszerzeniu
		await app.vault.createBinary(path, await file.entry.async('arraybuffer'));
	}
}

/** Tworzy folder razem z brakującymi poziomami wyżej - od korzenia w dół. */
async function ensureFolder(app: App, path: string, folders: Set<string>): Promise<void> {
	let current = '';

	for (const segment of path.split('/')) {
		current = current ? `${current}/${segment}` : segment;

		if (folders.has(current)) continue;
		if (app.vault.getAbstractFileByPath(current) === null) {
			await app.vault.createFolder(current);
		}

		folders.add(current);
	}
}

/**
 * Sprząta po nieudanej instalacji.
 *
 * Folder trafia do kosza, a nie znika bezpowrotnie - gdyby walidacja miała
 * kiedyś fałszywy alarm, user odzyska pliki.
 */
async function rollback(app: App, root: string): Promise<void> {
	const folder = app.vault.getAbstractFileByPath(root);
	if (folder === null) return;

	try {
		await app.fileManager.trashFile(folder);
	} catch (error) {
		console.error('Nie udało się posprzątać po nieudanej instalacji', error);
	}
}
