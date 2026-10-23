import { Notice, Setting } from "obsidian";

export function settingsToJson(settings: unknown): string {
	return JSON.stringify(settings, null, 2);
}

/** Parse a settings file. Throws if the payload is not a JSON object. */
export function parseSettingsJson<T>(text: string, normalize: (raw: unknown) => T): T {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new Error("Invalid JSON");
	}
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("Settings file must be a JSON object");
	}
	return normalize(raw);
}

/** Copy a normalized settings object onto the live settings reference. */
export function applyImportedSettings<T extends object>(target: T, next: T): void {
	Object.assign(target, next);
}

export function downloadSettingsJson(settings: unknown, filename: string): void {
	const blob = new Blob([settingsToJson(settings)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const link = createEl("a", { href: url, attr: { download: filename } });
	link.click();
	URL.revokeObjectURL(url);
}

export function mountSettingsFileControls<T extends object>(
	container: HTMLElement,
	options: {
		filename: string;
		pluginName: string;
		getSettings: () => T;
		normalize: (raw: unknown) => T;
		onImported: (next: T) => void | Promise<void>;
	},
): void {
	new Setting(container).setName("Settings file").setHeading();

	new Setting(container)
		.setName("Export settings")
		.setDesc("Download the current configuration as JSON.")
		.addButton((btn) =>
			btn.setButtonText("Export").onClick(() => {
				downloadSettingsJson(options.getSettings(), options.filename);
			}),
		);

	new Setting(container)
		.setName("Import settings")
		.setDesc("Replace the current configuration from a JSON file.")
		.addButton((btn) =>
			btn.setButtonText("Import").onClick(() => {
				pickSettingsFile((text) => {
					try {
						const next = parseSettingsJson(text, options.normalize);
						void Promise.resolve(options.onImported(next)).then(
							() => {
								new Notice(`${options.pluginName} settings imported`);
							},
							() => {
								new Notice("Could not import settings");
							},
						);
					} catch (err) {
						new Notice(err instanceof Error ? err.message : "Could not import settings");
					}
				});
			}),
		);
}

export function pickSettingsFile(onText: (text: string) => void): void {
	const input = createEl("input", {
		type: "file",
		attr: { accept: ".json,application/json" },
	});
	input.addEventListener("change", () => {
		const file = input.files?.[0];
		if (!file) return;
		void file.text().then(onText, () => {
			new Notice("Could not read the settings file");
		});
	});
	input.click();
}
