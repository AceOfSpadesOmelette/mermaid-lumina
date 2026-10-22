import {
	App,
	MarkdownPostProcessorContext,
	Plugin,
	PluginSettingTab,
	Setting,
	setIcon,
} from "obsidian";
import { MermaidLuminaLightbox } from "./lightbox";
import { applyImportedSettings, mountSettingsFileControls } from "./settings-io";
import {
	DEFAULT_SETTINGS,
	normalizeSettings,
	type MermaidLuminaSettings,
} from "./settings";

/** Reading view / page preview / embeds. */
const READING_SELECTOR = ".markdown-preview-view, .markdown-reading-view";

const SOURCE_ATTR = "data-lumina-source";
const ZOOM_BTN_CLASS = "mermaid-lumina-zoom-btn";
const TOOLBAR_CLASS = "mermaid-lumina-toolbar";
const LIVE_PREVIEW_CLASS = "mermaid-lumina-live-preview";
const EMBED_HOST_SELECTOR = ".cm-embed-block, .cm-preview-code-block";

export default class MermaidLuminaPlugin extends Plugin {
	settings: MermaidLuminaSettings = { ...DEFAULT_SETTINGS };
	private lightbox = new MermaidLuminaLightbox();
	private decorateQueued = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applyLivePreviewClass();
		this.addSettingTab(new MermaidLuminaSettingTab(this.app, this));

		this.registerMarkdownPostProcessor((el, ctx) => {
			this.annotateMermaidSources(el, ctx);
			this.decorateMermaidIn(el);
		});

		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			this.onDocumentClick(evt);
		});

		this.app.workspace.onLayoutReady(() => this.queueDecorateAll());
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.queueDecorateAll()),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.queueDecorateAll()),
		);

		const observer = new MutationObserver(() => this.queueDecorateAll());
		observer.observe(document.body, { childList: true, subtree: true });
		this.register(() => observer.disconnect());
	}

	onunload(): void {
		this.lightbox.close();
		document.body.classList.remove(LIVE_PREVIEW_CLASS);

		document.querySelectorAll(`.${TOOLBAR_CLASS}`).forEach((toolbar) => {
			const parent = toolbar.parentElement;
			const editBtn = toolbar.querySelector(".edit-block-button");
			if (parent && editBtn) {
				parent.insertBefore(editBtn, toolbar);
			}
			toolbar.remove();
		});
		document.querySelectorAll(`.${ZOOM_BTN_CLASS}`).forEach((btn) => btn.remove());
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.applyLivePreviewClass();
		this.queueDecorateAll();
	}

	private applyLivePreviewClass(): void {
		document.body.classList.toggle(LIVE_PREVIEW_CLASS, this.settings.enableLivePreview);
	}

	private queueDecorateAll(): void {
		if (this.decorateQueued) return;
		this.decorateQueued = true;
		window.setTimeout(() => {
			this.decorateQueued = false;
			this.decorateMermaidIn(document.body);
		}, 50);
	}

	private decorateMermaidIn(root: ParentNode): void {
		const blocks = root.querySelectorAll?.(".mermaid");
		if (!blocks) return;
		for (const block of Array.from(blocks)) {
			this.ensureZoomButton(block as HTMLElement);
		}
	}

	private ensureZoomButton(mermaidEl: HTMLElement): void {
		if (!mermaidEl.querySelector("svg")) return;

		const host =
			(mermaidEl.closest(EMBED_HOST_SELECTOR) as HTMLElement | null) ?? mermaidEl;

		if (!this.isEligibleMermaid(mermaidEl)) {
			this.removeZoomChrome(host);
			return;
		}

		if (getComputedStyle(host).position === "static") {
			host.style.position = "relative";
		}

		let toolbar = host.querySelector(`:scope > .${TOOLBAR_CLASS}`) as HTMLElement | null;
		if (!toolbar) {
			toolbar = document.createElement("div");
			toolbar.className = TOOLBAR_CLASS;
			const existingEdit = host.querySelector(":scope > .edit-block-button");
			if (existingEdit) {
				existingEdit.before(toolbar);
			} else {
				host.appendChild(toolbar);
			}
		}

		let zoomBtn = toolbar.querySelector(`:scope > .${ZOOM_BTN_CLASS}`) as HTMLButtonElement | null;
		if (!zoomBtn) {
			zoomBtn = document.createElement("button");
			zoomBtn.type = "button";
			zoomBtn.className = `${ZOOM_BTN_CLASS} clickable-icon`;
			zoomBtn.title = "Open Mermaid lightbox";
			zoomBtn.setAttribute("aria-label", "Open Mermaid lightbox");
			setIcon(zoomBtn, "zoom-in");
			zoomBtn.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				if (this.isEligibleMermaid(mermaidEl)) {
					void this.lightbox.open(mermaidEl);
				}
			});
			toolbar.insertBefore(zoomBtn, toolbar.firstChild);
		}

		const editBtn = host.querySelector(".edit-block-button");
		if (editBtn && editBtn.parentElement !== toolbar) {
			toolbar.appendChild(editBtn);
		}
	}

	private removeZoomChrome(host: HTMLElement): void {
		const toolbar = host.querySelector(`:scope > .${TOOLBAR_CLASS}`);
		if (!toolbar) {
			host.querySelector(`:scope > .${ZOOM_BTN_CLASS}`)?.remove();
			return;
		}
		const editBtn = toolbar.querySelector(".edit-block-button");
		if (editBtn) {
			toolbar.before(editBtn);
		}
		toolbar.remove();
	}

	private annotateMermaidSources(
		root: HTMLElement,
		ctx?: MarkdownPostProcessorContext,
	): void {
		const sectionSource = mermaidSourceFromSection(ctx?.getSectionInfo(root)?.text);
		const blocks = root.querySelectorAll(".mermaid");
		for (const block of Array.from(blocks)) {
			const el = block as HTMLElement;
			if (el.getAttribute(SOURCE_ATTR)) continue;

			const source =
				sectionSource ??
				mermaidSourceFromSection(ctx?.getSectionInfo(el)?.text) ??
				sourceFromDom(el);

			if (source) {
				el.setAttribute(SOURCE_ATTR, source);
				el.dataset.mermaidSource = source;
			}
		}
	}

	private onDocumentClick(evt: MouseEvent): void {
		if (this.lightbox.isOpen) return;

		const target = evt.target;
		if (!(target instanceof Element)) return;

		const zoomBtn = target.closest(`.${ZOOM_BTN_CLASS}`);
		if (zoomBtn) {
			const host = zoomBtn.closest(`${EMBED_HOST_SELECTOR}, .mermaid`) as HTMLElement | null;
			let mermaidEl: HTMLElement | null = null;
			if (host?.matches(".mermaid")) {
				mermaidEl = host;
			} else if (host) {
				mermaidEl = host.querySelector(".mermaid");
			}
			if (!mermaidEl) {
				mermaidEl = zoomBtn.closest(".mermaid");
			}
			if (
				mermaidEl?.querySelector("svg") &&
				this.isEligibleMermaid(mermaidEl)
			) {
				evt.preventDefault();
				evt.stopPropagation();
				void this.lightbox.open(mermaidEl);
			}
			return;
		}

		if (target.closest("a, button, input, textarea")) {
			return;
		}

		const mermaidEl = target.closest(".mermaid") as HTMLElement | null;
		if (
			mermaidEl?.querySelector("svg") &&
			this.isEligibleMermaid(mermaidEl)
		) {
			evt.preventDefault();
			evt.stopPropagation();
			void this.lightbox.open(mermaidEl);
		}
	}

	/** Reading view always; Live Preview when the setting is on. */
	private isEligibleMermaid(el: HTMLElement): boolean {
		if (el.closest(READING_SELECTOR)) return true;
		if (this.settings.enableLivePreview) {
			return Boolean(el.closest(".markdown-source-view"));
		}
		return false;
	}
}

class MermaidLuminaSettingTab extends PluginSettingTab {
	plugin: MermaidLuminaPlugin;

	constructor(app: App, plugin: MermaidLuminaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Mermaid Lumina" });

		new Setting(containerEl)
			.setName("Enable in Live Preview (editing mode)")
			.setDesc(
				"When on, rendered Mermaid diagrams in Live Preview show a zoom-in cursor and a top-right magnify button, and clicking opens the lightbox (same idea as images). Reading view is always enabled.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableLivePreview)
					.onChange(async (value) => {
						this.plugin.settings.enableLivePreview = value;
						await this.plugin.saveSettings();
					}),
			);

		mountSettingsFileControls(containerEl, {
			filename: "mermaid-lumina-settings.json",
			pluginName: "Mermaid Lumina",
			getSettings: () => this.plugin.settings,
			normalize: normalizeSettings,
			onImported: async (next) => {
				applyImportedSettings(this.plugin.settings, next);
				await this.plugin.saveSettings();
				this.display();
			},
		});
	}
}

/** Pull mermaid code from a fenced ```mermaid section. */
function mermaidSourceFromSection(raw: string | undefined | null): string | null {
	if (!raw) return null;
	const text = raw.trim();
	if (!text) return null;
	const fence = text.match(/^```\s*mermaid[^\n]*\r?\n([\s\S]*?)(?:\r?\n```)?\s*$/i);
	if (fence?.[1]) return fence[1].trim() || null;
	return null;
}

function sourceFromDom(el: HTMLElement): string | null {
	let source = "";
	for (const node of Array.from(el.childNodes)) {
		if (node.nodeType === Node.TEXT_NODE) {
			source += node.textContent ?? "";
		}
	}
	source = source.trim();
	if (source && !source.startsWith("<")) return source;
	return null;
}
