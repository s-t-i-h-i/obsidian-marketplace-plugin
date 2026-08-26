import { App, Modal, Setting, Notice, TFolder } from "obsidian";
import JSZip from "jszip";
import { ALLOWED_EXTENSIONS } from './constants';

const API_BASE = "https://your-worker.workers.dev"; // podmień na swój URL

export class PublishModal extends Modal {
private folder: TFolder;
private title = "";
private description = "";
private author = "";
private tags = "";
private isPublishing = false;

constructor(app: App, folder: TFolder) {
    super(app);
    this.folder = folder;
}

onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: `Publikuj: ${this.folder.name}` });

    new Setting(contentEl)
    .setName("Tytuł")
    .addText((text) => text.onChange((value) => (this.title = value)));

    new Setting(contentEl)
    .setName("Opis")
    .addTextArea((text) => text.onChange((value) => (this.description = value)));

    new Setting(contentEl)
    .setName("Autor")
    .addText((text) => text.onChange((value) => (this.author = value)));

    new Setting(contentEl)
    .setName("Tagi")
    .setDesc("Oddzielone przecinkami")
    .addText((text) => text.onChange((value) => (this.tags = value)));

    new Setting(contentEl).addButton((btn) =>
    btn
        .setButtonText("Publish")
        .setCta()
        .onClick(() => this.handlePublish())
    );
}

private async handlePublish() {
    if (this.isPublishing) return;

    if (!this.title.trim() || !this.author.trim()) {
    new Notice("Tytuł i autor są wymagane");
    return;
    }

    this.isPublishing = true;
    new Notice("Pakowanie folderu...");

    try {
    const zipBlob = await this.packFolder();

    new Notice("Wysyłanie...");
    await this.upload(zipBlob);

    new Notice("Opublikowano");
    this.close();
    } catch (err) {
    console.error(err);
    new Notice("Błąd publikacji: " + (err as Error).message);
    } finally {
    this.isPublishing = false;
    }
}

private async packFolder(): Promise<Blob> {
    const zip = new JSZip();
    const prefix = this.folder.path + "/";

    const files = this.app.vault
    .getFiles()
    .filter((file) => file.path.startsWith(prefix));

    for (const file of files) {
    if (!ALLOWED_EXTENSIONS.includes(file.extension)) {
        continue;
    }

    const content = await this.app.vault.readBinary(file);
    const relativePath = file.path.slice(prefix.length);
    zip.file(relativePath, content);
    }

    return zip.generateAsync({ type: "blob" });
}

private async upload(zipBlob: Blob): Promise<void> {
    const formData = new FormData();
    formData.append("title", this.title.trim());
    formData.append("description", this.description.trim());
    formData.append("author", this.author.trim());
    formData.append("tags", this.tags.trim());
    formData.append("file", zipBlob, `${this.folder.name}.zip`);

    const response = await fetch(`${API_BASE}/publish`, {
    method: "POST",
    body: formData,
    });

    if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status}: ${body}`);
    }
}

onClose() {
    this.contentEl.empty();
}
}