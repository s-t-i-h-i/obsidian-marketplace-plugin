import { ButtonComponent } from 'obsidian';

/**
 * Dwustopniowe potwierdzenie dla nieodwracalnych akcji.
 *
 * Obsidian nie ma wbudowanego okna potwierdzenia, a osobny Modal dla każdego
 * "na pewno?" byłby cięższy niż sama akcja. Pierwsze kliknięcie uzbraja przycisk,
 * drugie wykonuje. Uzbrojenie samo wygasa - przycisk kasujący, który został
 * gotowy na zawsze, to pułapka.
 */
export function armButton(
	button: ButtonComponent,
	label: string,
	confirmLabel: string,
	action: () => void,
): void {
	let armed = false;

	const disarm = () => {
		armed = false;
		button.buttonEl.removeClass('mod-warning');
		button.setButtonText(label);
	};

	button.setButtonText(label).onClick(() => {
		if (armed) {
			disarm();
			action();
			return;
		}

		armed = true;
		button.setWarning().setButtonText(confirmLabel);

		window.setTimeout(() => {
			// przycisk mógł zniknąć razem z przerysowaną zakładką
			if (button.buttonEl.isConnected) disarm();
		}, 4000);
	});
}
