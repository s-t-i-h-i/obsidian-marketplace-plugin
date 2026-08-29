import { Plugin, TFolder } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MarketplaceSettings,
	MarketplaceSettingTab,
} from './settings';
import { openPublishModal } from './publishModal';
import { openMarketplaceModal } from './marketplaceModal';

export default class MarketplacePlugin extends Plugin {
	settings!: MarketplaceSettings;

	async onload() {
		await this.loadSettings();
		// komenda do otwierania marketplace
		this.addCommand({
			id: 'open-marketplace',
			name: 'Open marketplace',
			callback: () => openMarketplaceModal(this),
		});

		// pozycja "Publikuj" w menu kontekstowym folderu w panelu plików
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFolder)) return;

				menu.addItem((item) =>
					item
						.setTitle('Publish')
						.setIcon('upload')
						.onClick(() => openPublishModal(this, file)),
				);
			}),
		);

		this.addSettingTab(new MarketplaceSettingTab(this.app, this));
	}

	async loadSettings() {
		const stored = ((await this.loadData()) ?? {}) as Record<string, unknown>;

		// Przepisujemy wyłącznie znane klucze zamiast Object.assign: adres API
		// przeniósł się do kodu, a zapisany kiedyś `apiBaseUrl` siedziałby dalej
		// w data.json i mylił przy diagnozie ("czemu wtyczka gada z localhostem?").
		// Nieznane pola znikają przy najbliższym zapisie ustawień.
		this.settings = { ...DEFAULT_SETTINGS };
		for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof MarketplaceSettings)[]) {
			const value = stored[key];
			if (typeof value === 'string') this.settings[key] = value;
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
