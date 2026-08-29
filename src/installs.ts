import { App, normalizePath } from 'obsidian';
import JSZip from 'jszip';
import { DEFAULT_SETTINGS } from './settings';
import {
	ALLOWED_EXTENSIONS,
	MAX_ARCHIVE_BYTES,
	MAX_ENTRIES,
	MAX_ENTRY_DEPTH,
	MAX_ENTRY_PATH,
	MAX_FOLDER_NAME,
	MAX_COMPRESSION_RATIO,
	MAX_UNCOMPRESSED_BYTES,
} from './constants';
import { isScannable, scanContent, type Finding } from './scan';

/**
 * Znaki, których nie wolno wpuścić do nazwy folderu.
 *
 * Pierwsza grupa (\ / : * ? " < > |) odpadłaby na poziomie systemu plików,
 * druga (# ^ [ ]) przeszłaby, ale psułaby składnię linków w Obsidianie.
 */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

/**
 * Znaki sterujące i NUL - obcinają ścieżkę w warstwie systemowej.
 *
 * Reguła no-control-regex wyłączona świadomie: te znaki są tu przedmiotem
 * kontroli, a nie pomyłką autora.
 */
// eslint-disable-next-line no-control-regex -- te znaki sa tu przedmiotem kontroli, nie pomylka
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Przesterowanie kierunku tekstu (U+202E i krewni). Nazwa zawierająca RLO
 * wyświetla się z odwróconym końcem, więc udaje inne rozszerzenie, niż ma.
 */
const BIDI_CHARS = /[\u202a-\u202e\u2066-\u2069\u200e\u200f]/;

/**
 * Wersje globalne, wyłącznie do czyszczenia tytułu.
 *
 * Rozdzielone celowo: `replace()` bez /g podmienia tylko pierwsze trafienie,
 * ale `test()` na wyrażeniu z /g jest stanowy - pamięta `lastIndex` między
 * wywołaniami, więc co drugie sprawdzenie tej samej nazwy wychodziłoby czyste.
 */
const CONTROL_CHARS_ALL = new RegExp(CONTROL_CHARS.source, 'g');
const BIDI_CHARS_ALL = new RegExp(BIDI_CHARS.source, 'g');

/** Nazwy urządzeń DOS. Na Windowsie plik o takiej nazwie nie powstanie, nawet z rozszerzeniem. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** Ile razy dopisujemy numer do zajętej nazwy, zanim się poddamy. */
const MAX_NAME_ATTEMPTS = 100;

/** Wpis z archiwum, którego ścieżka przeszła już walidację. */
interface PlannedFile {
	/** Ścieżka względem folderu paczki, np. "obrazki/schemat.png". */
	path: string;
	entry: JSZip.JSZipObject;
}

/** Sprawdzone archiwum, gotowe do zapisania. */
export interface PackagePlan {
	files: PlannedFile[];
	/** Aktywna treść znaleziona w plikach - do pokazania użytkownikowi PRZED zapisem. */
	findings: Finding[];
	/** Rozmiar po rozpakowaniu, wg deklaracji archiwum. */
	totalBytes: number;
}

/**
 * Sprawdza archiwum i przygotowuje listę plików do zapisania.
 *
 * Rozdzielone od zapisu celowo: pobrana paczka to cudze notatki, więc użytkownik
 * ma prawo zobaczyć, co w niej jest, ZANIM cokolwiek wyląduje w jego vaulcie.
 * Sama walidacja niczego nie zapisuje.
 */
export async function inspectArchive(archive: ArrayBuffer): Promise<PackagePlan> {
	if (archive.byteLength === 0) {
		throw new Error('The downloaded file is empty');
	}
	if (archive.byteLength > MAX_ARCHIVE_BYTES) {
		throw new Error(
			`The archive is ${formatBytes(archive.byteLength)}, the limit is ${formatBytes(MAX_ARCHIVE_BYTES)}`,
		);
	}
	// Sygnatura przed JSZipem: serwer jest publiczny, a jego odpowiedź to po prostu
	// bajty. Bez tego użytkownik dostawał angielski komunikat wnętrza biblioteki.
	if (!hasZipMagic(new Uint8Array(archive))) {
		throw new Error('The downloaded file is not a ZIP archive');
	}

	const zip = await JSZip.loadAsync(archive);

	// Całe archiwum sprawdzamy, zanim zapiszemy pierwszy bajt. Walidacja to
	// same operacje na stringach i metadanych, a daje gwarancję "albo cała
	// paczka, albo nic".
	const files = planFiles(zip);
	if (files.length === 0) {
		throw new Error('The archive contains no files');
	}

	const totalBytes = assertUnpackedSize(files, archive.byteLength);
	const findings = await scanFiles(files);

	return { files, findings, totalBytes };
}

/**
 * Zapisuje sprawdzoną paczkę do vaulta i zwraca ścieżkę utworzonego folderu.
 *
 * Wywołujący używa jej do komunikatu i do otwarcia pobranej notatki.
 */
export async function installPlan(
	app: App,
	plan: PackagePlan,
	baseFolder: string,
	packageTitle: string,
): Promise<string> {
	const root = await createPackageFolder(app, baseFolder, packageTitle);

	try {
		await writeFiles(app, root, plan.files);
	} catch (error) {
		// pół paczki w vaulcie jest gorsze niż brak paczki
		await rollback(app, root);
		throw error;
	}

	return root;
}

/** PK\x03\x04 dla zwykłego archiwum, PK\x05\x06 dla archiwum bez wpisów. */
function hasZipMagic(bytes: Uint8Array): boolean {
	if (bytes.length < 4) return false;
	return (
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
	);
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
	const seen = new Set<string>();

	for (const entry of Object.values(zip.files)) {
		// foldery odtwarzamy ze ścieżek plików - ZIP wcale nie musi zawierać
		// wpisów katalogowych, więc i tak nie można na nich polegać
		if (entry.dir) continue;

		if (files.length >= MAX_ENTRIES) {
			throw new Error(`The archive contains more than ${MAX_ENTRIES} files`);
		}

		const path = safeRelativePath(entry.name);

		// macOS i Windows nie rozróżniają wielkości liter, więc "A.md" i "a.md"
		// to na nich jeden plik - drugi zapis rzuciłby dopiero w połowie instalacji.
		const key = path.toLowerCase();
		if (seen.has(key)) {
			throw new Error(`Duplicate path in archive: ${entry.name}`);
		}
		seen.add(key);

		files.push({ path, entry });
	}

	return files;
}

/**
 * Sprawdza, czy ścieżka z archiwum jest bezpieczna i czy w ogóle chcemy taki plik.
 *
 * Jeden przebieg po segmentach łapie wszystkie warianty ucieczki naraz:
 * ".." wychodzi poziom wyżej, pusty segment oznacza wiodący ukośnik
 * (czyli ścieżkę absolutną) albo "//" w środku, a "." tylko zaśmieca ścieżkę.
 */
function safeRelativePath(name: string): string {
	// niektóre archiwizatory zapisują separator windowsowy; nie chcemy zgadywać,
	// czy "a\b.md" to jeden plik z ukośnikiem w nazwie, czy dwa poziomy
	if (name.includes('\\')) {
		throw new Error(`Disallowed path in archive: ${name}`);
	}
	if (name.length > MAX_ENTRY_PATH) {
		throw new Error(`Path too long in archive: ${name.slice(0, 60)}...`);
	}
	if (CONTROL_CHARS.test(name)) {
		throw new Error('Control characters in archive path');
	}
	if (BIDI_CHARS.test(name)) {
		// To nie jest kosmetyka: taki plik w panelu plików pokazuje inne
		// rozszerzenie, niż ma naprawdę.
		throw new Error('Text-direction control characters in archive path');
	}

	const segments = name.split('/');
	if (segments.length > MAX_ENTRY_DEPTH) {
		throw new Error(`Nesting too deep in archive (${segments.length} levels)`);
	}

	for (const segment of segments) {
		if (segment === '' || segment === '.' || segment === '..') {
			throw new Error(`Disallowed path in archive: ${name}`);
		}
		// Kropka na początku ukrywa plik przed panelem plików Obsidiana - paczka
		// nie ma powodu przemycać niewidocznej zawartości.
		if (segment.startsWith('.')) {
			throw new Error(`Hidden file or folder in archive: ${name}`);
		}
		// Windows po cichu obcina końcową kropkę i spację, więc "nota .md" i "nota.md"
		// stają się tym samym plikiem - a to gotowa kolizja w połowie zapisu.
		if (/[. ]$/.test(segment)) {
			throw new Error(`Name ending in a dot or space: ${name}`);
		}
		if (WINDOWS_RESERVED.test(segment)) {
			throw new Error(`Reserved system name in archive: ${segment}`);
		}
	}

	// Rozszerzenia trzymamy tą samą listą, którą filtrujemy przy publikowaniu.
	// Bez tego pobranie paczki zapisywało do vaulta .js, .exe i pliki bez rozszerzenia,
	// choć spakować dało się wyłącznie notatki i obrazki.
	const extension = extensionOf(name);
	if (!ALLOWED_EXTENSIONS.includes(extension)) {
		throw new Error(
			`Disallowed file type in archive: ${name}` +
				(extension ? ` (.${extension})` : ' (no extension)'),
		);
	}

	return segments.join('/');
}

/**
 * Sprawdza rozmiar po rozpakowaniu, korzystając z deklaracji z archiwum.
 *
 * To jedyny moment, w którym da się zatrzymać bombę zip: po `async()` jest już
 * za późno, bo dane siedzą w pamięci. 204 kB archiwum potrafi zadeklarować
 * 200 MB zawartości.
 *
 * `_data` jest polem wewnętrznym JSZipa, więc czytamy je defensywnie - gdyby
 * biblioteka je kiedyś przemianowała, zostaje limit na liczbie plików.
 */
function assertUnpackedSize(files: PlannedFile[], archiveBytes: number): number {
	let total = 0;

	for (const file of files) {
		const data = (file.entry as unknown as { _data?: { uncompressedSize?: number } })._data;
		total += typeof data?.uncompressedSize === 'number' ? data.uncompressedSize : 0;
	}

	if (total > MAX_UNCOMPRESSED_BYTES) {
		throw new Error(
			`Unpacked, the package would take up ${formatBytes(total)}, the limit is ${formatBytes(MAX_UNCOMPRESSED_BYTES)}`,
		);
	}

	// Sam sufit nie wystarcza: archiwum tuż pod nim, ważące 200 kB, dalej jest bombą.
	if (total > MAX_COMPRESSION_RATIO * archiveBytes) {
		throw new Error(
			`Suspicious compression ratio: a ${formatBytes(archiveBytes)} archive unpacks to ${formatBytes(total)}`,
		);
	}

	return total;
}

/** Czyta pliki tekstowe z archiwum i szuka w nich aktywnej treści. */
async function scanFiles(files: PlannedFile[]): Promise<Finding[]> {
	const findings: Finding[] = [];

	for (const file of files) {
		if (!isScannable(file.path)) continue;
		findings.push(...scanContent(file.path, await file.entry.async('string')));
	}

	return findings;
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

	throw new Error(`Could not find a free folder name for "${packageTitle}"`);
}

/**
 * Robi z tytułu paczki nazwę folderu.
 *
 * Tytuł wpisał człowiek w formularzu publikacji, więc może zawierać cokolwiek -
 * łącznie ze znakami, które rozwalają ścieżkę albo tworzą folder ukryty.
 * Przycinamy też długość: systemy plików trzymają limit ~255 bajtów na segment,
 * a serwer przyjmował do niedawna tytuły na 200 tysięcy znaków.
 */
function toFolderName(title: string): string {
	const name = title
		.replace(CONTROL_CHARS_ALL, '')
		.replace(BIDI_CHARS_ALL, '')
		.replace(ILLEGAL_NAME_CHARS, '-')
		// wiodąca kropka ukrywa folder przed Obsidianem, końcowa psuje ścieżki na Windowsie
		.replace(/^[.\s]+|[.\s]+$/g, '')
		.slice(0, MAX_FOLDER_NAME)
		// obcięcie mogło odsłonić kolejną kropkę albo spację na końcu
		.replace(/[.\s]+$/g, '');

	if (!name) return 'package';
	return WINDOWS_RESERVED.test(name) ? `package ${name}` : name;
}

/** normalizePath() czyści ukośniki, ale zostawia ".." - a to wyprowadza poza vault. */
function assertInsideVault(path: string): void {
	if (path.split('/').some((segment) => segment === '..')) {
		throw new Error(`Disallowed destination folder: ${path}`);
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
		console.error('Failed to clean up after a failed installation', error);
	}
}

function extensionOf(path: string): string {
	const dot = path.lastIndexOf('.');
	const slash = path.lastIndexOf('/');
	return dot === -1 || dot < slash ? '' : path.slice(dot + 1).toLowerCase();
}

export function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
	return `${bytes} B`;
}
