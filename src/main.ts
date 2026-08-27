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
						.setTitle('Publikuj')
						.setIcon('upload')
						.onClick(() => openPublishModal(this, file)),
				);
			}),
		);

		this.addSettingTab(new MarketplaceSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MarketplaceSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
