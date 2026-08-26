import {
	Editor,
	MarkdownView,
	MarkdownFileInfo,
	Modal,
	Notice,
	Plugin,
	TFolder,
	TFile,
	App,
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
	SampleSettingTab,
} from './settings';
import { ALLOWED_EXTENSIONS } from './constants';
import { PublishModal } from './publishModal';

interface BrokenLink {
source: string;   // plik, który linkuje
target: string;   // plik, do którego linkuje
}

function collectFiles(folder: TFolder): TFile[] {
	const result: TFile[] = [];

	for (const child of folder.children) {
		if (child instanceof TFile) {
			// filter files by allowed extensions
			if (ALLOWED_EXTENSIONS.includes(child.extension)) {
				result.push(child);
			}
		}else if (child instanceof TFolder) {
			// recursively collect files from subfolders
			if (child.name.startsWith(".")) continue;
			//? ZROZUMIEC TEN SYNTAX REKURENCJI
			result.push(...collectFiles(child));
		}
	}
	return result;
}

function findBrokenLinks(app: App, files: TFile[]): BrokenLink[] {

	const mdFiles = files.filter(file => file.extension === "md");
	const results: BrokenLink[] = []
	const validPaths = new Set(files.map(f => f.path))
	for (const file of mdFiles) {
		// ches if links in the files are correct
		const links = app.metadataCache.resolvedLinks[file.path] 
		if( links === undefined) continue;
	
		for (const target in links) {
			if (!validPaths.has(target)) {
				results.push({ source: file.path, target });
			}
		}
	}
	return results;
}

export default class MarketplacexPlugin extends Plugin {
	settings!: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		//Uruchamia się za każdym razem, gdy ktoś otworzy menu kontekstowe pliku lub folderu w panelu plików.
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu,file)=> {
				//sprawdz czy to folder
				if (!(file instanceof TFolder)) {
					return;
				}

				// menu
				menu.addItem((item) => {
					item.setTitle('Opublikuj')
						.setIcon('upload')
						.onClick(async () => {
							try{
								await this.openPublishModalIfValid(file);
							}catch(e){
								new Notice(
									"Błąd publikacji: " +
									(e instanceof Error ? e.message : String(e)),
								);
							}
						})
				})
			})
		)
		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MyPluginSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async openPublishModalIfValid(folder: TFolder): Promise<void> {
	// Collect all files in the folder and its subfolders
	const files = collectFiles(folder);

	if (files.length === 0) {
		new Notice("Brak plików do opublikowania");
		return;
	}

	// resolve broken links
	const brokenLinks = findBrokenLinks(this.app, files)

	// if broken links found, show a notice and abort - do not open the modal
	if (brokenLinks.length > 0) {
		const brokenLinksMessage = brokenLinks.map(link => `Source: ${link.source}, Target: ${link.target}`).join('\n');
		new Notice(`Znaleziono ${brokenLinks.length} uszkodzonych linków:\n${brokenLinksMessage}`);
		return;
	}

	new PublishModal(this.app, folder).open();
	}
}

