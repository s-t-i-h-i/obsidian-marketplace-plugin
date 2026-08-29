/**
 * Wykrywanie aktywnej treści w plikach paczki.
 *
 * Powód: paczka to nie dane, tylko notatki, które ktoś zaraz otworzy w swoim
 * vaulcie. Sam Obsidian nie wykonuje JS-a z notatki, ale ekosystem wtyczek owszem —
 * blok ```dataviewjs (Dataview) albo `<%* %>` (Templater) to zwykły eval na
 * uprawnieniach aplikacji, czyli dostęp do całego vaulta i do sieci. Notatka z
 * takim blokiem wygląda w podglądzie dokładnie jak każda inna.
 *
 * Skaner jest heurystyczny i ma prawo dawać fałszywe alarmy — dlatego OSTRZEGA,
 * a nie blokuje. Decyzję podejmuje człowiek, który widzi listę znalezisk i wie,
 * czy sam napisał ten dataviewjs, czy dostał go od nieznajomego.
 */

export type Severity = 'danger' | 'warning';

export interface Finding {
	/** Ścieżka pliku wewnątrz paczki. */
	path: string;
	severity: Severity;
	/** Krótka nazwa zagrożenia, pokazywana użytkownikowi. */
	label: string;
	/** Fragment, który wywołał alarm - żeby dało się to samodzielnie ocenić. */
	sample: string;
}

interface Rule {
	pattern: RegExp;
	severity: Severity;
	label: string;
}

/**
 * Reguły dla plików tekstowych (.md).
 *
 * Wzorce trzymamy proste i bez zagnieżdżonych kwantyfikatorów: to jest kod
 * puszczany na cudzej treści, więc regex z nawrotami byłby własnym DoS-em.
 */
const MARKDOWN_RULES: Rule[] = [
	// --- wykonanie kodu ---
	{
		pattern: /```+\s*(dataviewjs|jsx:|js-engine|meta-bind-js|run-\w+|python|preload)\b/i,
		severity: 'danger',
		label: 'Blok kodu wykonywany przez wtyczki (Dataview/JS Engine/Execute Code)',
	},
	{
		pattern: /<%[\s\S]{0,4}?\*/,
		severity: 'danger',
		label: 'Polecenie wykonawcze Templatera (<%* ... %>)',
	},
	{
		pattern: /<%[-_]?\s*tp\.(user|system|file|config)\b/i,
		severity: 'danger',
		label: 'Wywołanie Templatera (tp.*)',
	},
	{ pattern: /<script[\s>]/i, severity: 'danger', label: 'Znacznik <script>' },
	{
		pattern: /<(iframe|object|embed|applet)[\s>]/i,
		severity: 'danger',
		label: 'Osadzona ramka lub obiekt (<iframe>/<object>)',
	},
	{
		// on<zdarzenie>= tuż przy znaku - łapie onerror=, onload=, onclick=...
		pattern: /<[a-z][^>\n]{0,200}\son[a-z]{3,15}\s*=/i,
		severity: 'danger',
		label: 'Atrybut zdarzenia HTML (onerror/onload/...)',
	},
	{ pattern: /javascript:/i, severity: 'danger', label: 'Adres javascript:' },
	{ pattern: /data:text\/html/i, severity: 'danger', label: 'Adres data:text/html' },

	// --- treść zdalna i lokalna: nie wykonuje kodu, ale wynosi informacje ---
	{
		pattern: /!\[[^\]\n]{0,200}\]\(\s*https?:\/\//i,
		severity: 'warning',
		label: 'Obrazek ładowany z sieci (ujawnia IP przy otwarciu notatki)',
	},
	{
		pattern: /<img[^>\n]{0,200}src\s*=\s*["']?https?:\/\//i,
		severity: 'warning',
		label: 'Obrazek ładowany z sieci (ujawnia IP przy otwarciu notatki)',
	},
	{
		pattern: /obsidian:\/\//i,
		severity: 'warning',
		label: 'Adres obsidian:// (potrafi uruchamiać akcje w aplikacji)',
	},
	{
		pattern: /(?:^|[\s("'])(?:file|app):\/\//i,
		severity: 'warning',
		label: 'Odwołanie do lokalnego pliku (file:// lub app://)',
	},
];

/** SVG to dokument XML, nie obrazek — potrafi nieść skrypt i odwołania do sieci. */
const SVG_RULES: Rule[] = [
	{ pattern: /<script[\s>]/i, severity: 'danger', label: 'Skrypt w pliku SVG' },
	{
		pattern: /<[a-z][^>\n]{0,200}\son[a-z]{3,15}\s*=/i,
		severity: 'danger',
		label: 'Atrybut zdarzenia w pliku SVG',
	},
	{ pattern: /<foreignObject[\s>]/i, severity: 'danger', label: 'foreignObject w SVG (osadza HTML)' },
	{ pattern: /javascript:/i, severity: 'danger', label: 'Adres javascript: w SVG' },
	{
		pattern: /(?:xlink:)?href\s*=\s*["']?https?:\/\//i,
		severity: 'warning',
		label: 'SVG pobiera zasób z sieci',
	},
];

/** Rozszerzenia, których zawartość w ogóle warto czytać. Obrazki rastrowe pomijamy. */
const SCANNABLE = new Set(['md', 'canvas', 'svg']);

export function isScannable(path: string): boolean {
	return SCANNABLE.has(extensionOf(path));
}

/**
 * Sprawdza zawartość jednego pliku.
 *
 * `content` to już zdekodowany tekst — dekodowanie zostawiamy wywołującemu,
 * bo przy publikowaniu bierze się z vaulta, a przy instalacji z archiwum.
 */
export function scanContent(path: string, content: string): Finding[] {
	const extension = extensionOf(path);

	if (extension === 'canvas') return scanCanvas(path, content);
	if (extension === 'svg') return applyRules(path, content, SVG_RULES);
	if (extension === 'md') return applyRules(path, content, MARKDOWN_RULES);

	return [];
}

function applyRules(path: string, content: string, rules: Rule[]): Finding[] {
	const findings: Finding[] = [];

	for (const rule of rules) {
		const match = rule.pattern.exec(content);
		// Jedno znalezisko na regułę: dwadzieścia obrazków z sieci w jednej notatce
		// to ta sama decyzja co jeden, a lista ma pozostać czytelna.
		if (match) {
			findings.push({
				path,
				severity: rule.severity,
				label: rule.label,
				sample: excerpt(content, match.index),
			});
		}
	}

	return findings;
}

/**
 * Canvas to JSON, nie tekst — regexy dałyby tu fałszywe alarmy z samego opisu węzłów.
 *
 * Interesuje nas jeden typ węzła: `link`, czyli żywe osadzenie strony WWW.
 * Otwarcie takiego canvasu ładuje cudzą stronę wewnątrz aplikacji.
 */
function scanCanvas(path: string, content: string): Finding[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return [{ path, severity: 'warning', label: 'Uszkodzony plik canvas (nie jest poprawnym JSON-em)', sample: '' }];
	}

	const nodes = (parsed as { nodes?: unknown })?.nodes;
	if (!Array.isArray(nodes)) return [];

	const findings: Finding[] = [];
	let remoteSeen = false;

	for (const node of nodes) {
		const entry = node as { type?: unknown; url?: unknown };
		if (entry?.type === 'link' && typeof entry.url === 'string' && !remoteSeen) {
			remoteSeen = true;
			findings.push({
				path,
				severity: 'danger',
				label: 'Canvas osadza żywą stronę WWW (węzeł typu link)',
				sample: entry.url.slice(0, 120),
			});
		}
	}

	return findings;
}

/** Kawałek wokół trafienia — bez tego użytkownik musiałby uwierzyć na słowo. */
function excerpt(content: string, index: number): string {
	const start = Math.max(0, index - 20);
	return content
		.slice(start, start + 120)
		.replace(/\s+/g, ' ')
		.trim();
}

function extensionOf(path: string): string {
	const dot = path.lastIndexOf('.');
	return dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
}

/** Grupuje znaleziska do komunikatu: najpierw groźne, potem ostrzeżenia. */
export function summarize(findings: Finding[]): { dangers: Finding[]; warnings: Finding[] } {
	return {
		dangers: findings.filter((f) => f.severity === 'danger'),
		warnings: findings.filter((f) => f.severity === 'warning'),
	};
}
