/** Minimal Obsidian API stubs for unit tests. */

export class Plugin {
	async loadData(): Promise<unknown> {
		return {};
	}
	async saveData(_data: unknown): Promise<void> {}
	registerMarkdownPostProcessor(_cb: unknown): void {}
	registerDomEvent(_el: HTMLElement, _type: string, _cb: unknown): void {}
	registerEvent(_ref: unknown): void {}
}

export class Notice {
	constructor(_message: string | DocumentFragment, _timeout?: number) {}
}

export class MarkdownRenderChild {
	containerEl: HTMLElement;
	constructor(containerEl: HTMLElement) {
		this.containerEl = containerEl;
	}
	onload(): void {}
	onunload(): void {}
}

export const Platform = {
	isDesktop: true,
	isMobile: false,
	isPhone: false,
	isDesktopApp: true,
	isMobileApp: false,
};
