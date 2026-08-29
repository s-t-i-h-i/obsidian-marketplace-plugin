import { App, TFile, TFolder } from 'obsidian';
import { ALLOWED_EXTENSIONS } from './constants';

/** Dlaczego link jest problemem - to rozróżnienie decyduje, co pokazać autorowi. */
export type LinkProblem =
	/** Cel istnieje w vaulcie, ale zostaje poza paczką. Odbiorca dostanie pusty link. */
	| 'outside'
	/** Cel nie istnieje nigdzie. Link był zepsuty już u autora. */
	| 'unresolved';

export interface BrokenLink {
	source: string; // plik, który linkuje
	target: string; // plik, do którego linkuje
	problem: LinkProblem;
}

/**
 * Zbiera pliki o dozwolonych rozszerzeniach z folderu i jego podfolderów.
 * Foldery zaczynające się od "." są pomijane.
 */
export function collectFiles(folder: TFolder): TFile[] {
	const result: TFile[] = [];

	for (const child of folder.children) {
		if (child instanceof TFile) {
			if (ALLOWED_EXTENSIONS.includes(child.extension)) {
				result.push(child);
			}
		} else if (child instanceof TFolder) {
			if (child.name.startsWith('.')) continue;
			result.push(...collectFiles(child));
		}
	}

	return result;
}

/**
 * Znajduje linki, które u odbiorcy paczki nie zadziałają.
 *
 * Są dwa źródła i oba są potrzebne:
 *
 * `resolvedLinks` to linki, które u AUTORA prowadzą do istniejącego pliku. Jeśli
 * cel nie wchodzi do paczki, u odbiorcy zostanie martwy link - a przy okazji jest
 * to sygnał, że paczka odwołuje się do czegoś prywatnego.
 *
 * `unresolvedLinks` to linki, które nie prowadzą nigdzie już u autora. Do tej pory
 * nie były sprawdzane w ogóle, więc paczka z `[[NieMaTakiegoPliku]]` publikowała
 * się jako czysta - funkcja nazywała się "findBrokenLinks", a znajdowała wyłącznie
 * linki wychodzące poza zestaw.
 */
export function findBrokenLinks(app: App, files: TFile[]): BrokenLink[] {
	const results: BrokenLink[] = [];
	const validPaths = new Set(files.map((file) => file.path));

	for (const file of files) {
		if (file.extension !== 'md') continue;

		const resolved = app.metadataCache.resolvedLinks[file.path];
		for (const target in resolved) {
			if (!validPaths.has(target)) {
				results.push({ source: file.path, target, problem: 'outside' });
			}
		}

		// Struktura jest ta sama co wyżej: ścieżka pliku -> { tekst linku: ile razy }.
		// Klucz to jednak surowy tekst linku, a nie ścieżka - bo pliku nie ma.
		const unresolved = app.metadataCache.unresolvedLinks[file.path];
		for (const target in unresolved) {
			results.push({ source: file.path, target, problem: 'unresolved' });
		}
	}

	return results;
}
