import { Setting } from 'obsidian';
import type { Finding } from './scan';

/**
 * Wspólny sposób pokazywania znalezisk skanera.
 *
 * Notice się do tego nie nadaje: znika po kilku sekundach, nie ma paska
 * przewijania i przy dwudziestu trafieniach zasłania pół ekranu. A to jest
 * dokładnie ten moment, w którym użytkownik ma coś przeczytać i zdecydować.
 */
export function renderFindings(parent: HTMLElement, findings: Finding[]): void {
	const dangers = findings.filter((finding) => finding.severity === 'danger');
	const warnings = findings.filter((finding) => finding.severity === 'warning');

	if (dangers.length > 0) {
		renderGroup(parent, 'Aktywna treść', dangers, 'marketplace-finding-danger');
	}
	if (warnings.length > 0) {
		renderGroup(parent, 'Do sprawdzenia', warnings, 'marketplace-finding-warning');
	}
}

function renderGroup(
	parent: HTMLElement,
	title: string,
	findings: Finding[],
	cls: string,
): void {
	parent.createEl('h4', { text: `${title} (${findings.length})` });
	const list = parent.createDiv({ cls: 'marketplace-findings' });

	for (const finding of findings) {
		const row = list.createDiv({ cls: `marketplace-finding ${cls}` });
		row.createDiv({ cls: 'marketplace-finding-label', text: finding.label });
		row.createDiv({ cls: 'marketplace-finding-path', text: finding.path });
		if (finding.sample) {
			// Fragment wstawiamy jako TEKST, nigdy jako HTML - to jest przecież
			// treść, którą właśnie oskarżamy o bycie kodem.
			row.createEl('code', { cls: 'marketplace-finding-sample', text: finding.sample });
		}
	}
}

/** Przycisk potwierdzenia i anulowania w jednym rzędzie. */
export function renderConfirmRow(
	parent: HTMLElement,
	confirmLabel: string,
	onConfirm: () => void,
	onCancel: () => void,
	warn = true,
): void {
	new Setting(parent)
		.addButton((button) => {
			button.setButtonText(confirmLabel).onClick(onConfirm);
			// Groźna akcja nie dostaje przycisku "call to action" - wyróżnienie
			// należy się wyjściu, nie brnięciu dalej.
			if (warn) button.setWarning();
		})
		.addButton((button) => button.setButtonText('Anuluj').setCta().onClick(onCancel));
}
