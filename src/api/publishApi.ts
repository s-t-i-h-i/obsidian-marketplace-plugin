import { App, TFile, TFolder } from 'obsidian';
import JSZip from 'jszip';
import { apiRequest } from './api';
import type { MarketplaceSettings } from '../settings';

export interface PublishMetadata {
	title: string;
	description: string;
	tags: string[];
}

/**
 * Pakuje archiwum i wysyła je na serwer marketplace.
 *
 * `files` to lista sprawdzona już przez openPublishModal() - dzięki temu
 * publikujemy dokładnie ten zestaw plików, który przeszedł walidację linków.
 */
export async function publishFolder(
	app: App,
	folder: TFolder,
	files: TFile[],
	metadata: PublishMetadata,
	settings: MarketplaceSettings,
): Promise<void> {
	// ścieżka korzenia vaulta to "/", więc nie ma wtedy prefiksu do obcięcia
	const prefix = folder.isRoot() ? '' : folder.path + '/';
	// dokładnie te ścieżki trafiają do ZIP-a, więc podgląd na stronie nie skłamie
	const structure = files.map((file) => file.path.slice(prefix.length));

	const archive = await packFolder(app, files, prefix);
	await upload(archive, `${folder.name}.zip`, metadata, structure, settings);
}

async function packFolder(
	app: App,
	files: TFile[],
	prefix: string,
): Promise<ArrayBuffer> {
	const zip = new JSZip();

	for (const file of files) {
		zip.file(file.path.slice(prefix.length), await app.vault.readBinary(file));
	}

	return zip.generateAsync({ type: 'arraybuffer' });
}

async function upload(
	archive: ArrayBuffer,
	filename: string,
	metadata: PublishMetadata,
	structure: string[],
	settings: MarketplaceSettings,
): Promise<void> {
	const boundary = randomBoundary();
	const body = buildMultipartBody(
		boundary,
		{
			title: metadata.title,
			description: metadata.description,
			tags: metadata.tags.join(','),
			structure: JSON.stringify(structure),
			// pole "author" znika z formularza - serwer bierze autora z tokenu
		},
		filename,
		archive,
	);

	// Token idzie nagłówkiem, a nie polem formularza: wartości pól trafiają do ciała
	// multipart bez cudzysłowów i bez escapowania, więc sekret nie ma czego tam szukać.
	await apiRequest(settings, {
		path: '/publish',
		method: 'POST',
		contentType: `multipart/form-data; boundary=${boundary}`,
		body,
		auth: true,
	});
}

/**
 * Granica musi być nieodgadywalna.
 *
 * Wcześniej brała się z Date.now(), a wartości pól wstawiamy do ciała surowo -
 * wystarczyło więc, żeby opis paczki zawierał linię `--<granica>`, i dało się
 * domknąć część oraz dokleić własne pola. Losowa granica zamyka to u źródła,
 * bez okaleczania treści: opis dalej może być wielolinijkowy.
 */
function randomBoundary(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
	return `----ObsidianBoundary${hex}`;
}

/** requestUrl() nie przyjmuje FormData, więc ciało multipart budujemy ręcznie. */
function buildMultipartBody(
	boundary: string,
	fields: Record<string, string>,
	filename: string,
	archive: ArrayBuffer,
): ArrayBuffer {
	const encoder = new TextEncoder();
	const parts: Uint8Array[] = [];

	for (const [name, value] of Object.entries(fields)) {
		parts.push(
			encoder.encode(
				`--${boundary}\r\n` +
					`Content-Disposition: form-data; name="${name}"\r\n\r\n` +
					`${value}\r\n`,
			),
		);
	}

	// cudzysłów lub nowa linia w nazwie folderu rozwaliłyby nagłówek
	const safeFilename = filename.replace(/[\r\n"]/g, '');
	parts.push(
		encoder.encode(
			`--${boundary}\r\n` +
				`Content-Disposition: form-data; name="file"; filename="${safeFilename}"\r\n` +
				`Content-Type: application/zip\r\n\r\n`,
		),
	);
	parts.push(new Uint8Array(archive));
	parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

	const body = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		body.set(part, offset);
		offset += part.length;
	}

	return body.buffer;
}
