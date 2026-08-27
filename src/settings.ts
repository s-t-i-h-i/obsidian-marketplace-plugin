import { App, PluginSettingTab, Setting } from 'obsidian';
import MarketplacePlugin from './main';

export interface MarketplaceSettings {
	apiBaseUrl: string;
	defaultAuthor: string;
	downloadFolder: string;
}

export const DEFAULT_SETTINGS: MarketplaceSettings = {
	apiBaseUrl: '',
	defaultAuthor: '',
	downloadFolder: 'marketplace-downloads'
};

export class MarketplaceSettingTab extends PluginSettingTab {
	plugin: MarketplacePlugin;

	constructor(app: App, plugin: MarketplacePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Adres API')
			.setDesc('Bazowy URL serwera, na który trafiają publikowane foldery.')
			.addText((text) =>
				text
					.setPlaceholder('https://twoj-worker.workers.dev')
					.setValue(this.plugin.settings.apiBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.apiBaseUrl = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Domyślny autor')
			.setDesc('Wstawiany automatycznie do formularza publikacji.')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.defaultAuthor)
					.onChange(async (value) => {
						this.plugin.settings.defaultAuthor = value;
						await this.plugin.saveSettings();
					}),
			);
		
		new Setting(containerEl)
			.setName('Folder pobierania')
			.setDesc('folder in which the downladed files from market place will be placed')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.downloadFolder)
					.onChange(async (value) => {
						this.plugin.settings.downloadFolder = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
