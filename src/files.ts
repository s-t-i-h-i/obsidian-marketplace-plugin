import { App, TFile, TFolder } from 'obsidian';
import { ALLOWED_EXTENSIONS } from './constants';

/** Why a link is a problem — this decides what to show the author. */
export type LinkProblem =
	/** The target exists in the vault but isn't part of the package — a dead link for anyone who installs it. */
	| 'outside'
	/** The target doesn't exist anywhere — already broken for the author. */
	| 'unresolved';

export interface BrokenLink {
	source: string; // the file containing the link
	target: string; // the link's target
	problem: LinkProblem;
}

/**
 * Collects files with allowed extensions from a folder and its subfolders.
 * Folders starting with "." are skipped.
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
 * Finds links that will be dead for anyone who installs the package.
 *
 * Two sources, both needed: `resolvedLinks` are links that resolve for the
 * author but point outside the package — a sign the package leans on
 * private notes. `unresolvedLinks` are links that don't resolve even for the
 * author (e.g. `[[MissingNote]]`) — easy to miss otherwise.
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

		// Same shape as above (path -> { link text: count }), but the key
		// here is the raw link text, not a path, since there's no file to point at.
		const unresolved = app.metadataCache.unresolvedLinks[file.path];
		for (const target in unresolved) {
			results.push({ source: file.path, target, problem: 'unresolved' });
		}
	}

	return results;
}
