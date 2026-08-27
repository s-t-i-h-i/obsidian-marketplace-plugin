import { App, TFile, TFolder, requestUrl } from 'obsidian';
import JSZip from 'jszip';

export interface PublishMetadata {
	title: string;
	description: string;
	author: string;
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
	apiBaseUrl: string,
): Promise<void> {
	const archive = await packFolder(app, folder, files);
	await upload(archive, `${folder.name}.zip`, metadata, apiBaseUrl);
}

async function packFolder(
	app: App,
	folder: TFolder,
	files: TFile[],
): Promise<ArrayBuffer> {
	const zip = new JSZip();
	// ścieżka korzenia vaulta to "/", więc nie ma wtedy prefiksu do obcięcia
	const prefix = folder.isRoot() ? '' : folder.path + '/';

	for (const file of files) {
		zip.file(file.path.slice(prefix.length), await app.vault.readBinary(file));
	}

	return zip.generateAsync({ type: 'arraybuffer' });
}

async function upload(
	archive: ArrayBuffer,
	filename: string,
	metadata: PublishMetadata,
	apiBaseUrl: string,
): Promise<void> {
	const boundary = `----ObsidianBoundary${Date.now().toString(16)}`;
	const body = buildMultipartBody(
		boundary,
		{
			title: metadata.title,
			description: metadata.description,
			author: metadata.author,
			tags: metadata.tags.join(','),
		},
		filename,
		archive,
	);

	const response = await requestUrl({
		url: `${apiBaseUrl.replace(/\/+$/, '')}/publish`,
		method: 'POST',
		contentType: `multipart/form-data; boundary=${boundary}`,
		body,
		// domyślnie requestUrl rzuca wyjątkiem i gubi treść odpowiedzi serwera
		throw: false,
	});

	if (response.status < 200 || response.status >= 300) {
		throw new Error(`${response.status}: ${response.text}`);
	}
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
