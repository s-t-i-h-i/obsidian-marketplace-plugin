import { App, TFile, TFolder } from 'obsidian';
import { ALLOWED_EXTENSIONS } from './constants';

export interface BrokenLink {
	source: string; // plik, który linkuje
	target: string; // plik, do którego linkuje
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

/** Znajduje linki wychodzące poza zestaw publikowanych plików. */
export function findBrokenLinks(app: App, files: TFile[]): BrokenLink[] {
	const results: BrokenLink[] = [];
	const validPaths = new Set(files.map((file) => file.path));

	for (const file of files) {
		if (file.extension !== 'md') continue;

		const links = app.metadataCache.resolvedLinks[file.path];
		if (links === undefined) continue;

		for (const target in links) {
			if (!validPaths.has(target)) {
				results.push({ source: file.path, target });
			}
		}
	}

	return results;
}
