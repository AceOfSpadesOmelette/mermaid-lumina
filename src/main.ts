import {
	App,
	MarkdownPostProcessorContext,
	Notice,
	Plugin,
	PluginSettingTab,
	setIcon,
	type SettingDefinitionItem,
} from "obsidian";
import { MermaidLuminaLightbox } from "./lightbox";
import {
	applyImportedSettings,
	downloadSettingsJson,
	parseSettingsJson,
	pickSettingsFile,
} from "./settings-io";
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
const TOOLBAR_HOST_CLASS = "mermaid-lumina-has-toolbar";
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

	applyLivePreviewClass(): void {
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
			if (!block.instanceOf(HTMLElement)) continue;
			this.ensureZoomButton(block);
		}
	}

	private ensureZoomButton(mermaidEl: HTMLElement): void {
		if (!mermaidEl.querySelector("svg")) return;

		const embedded = mermaidEl.closest(EMBED_HOST_SELECTOR);
		const host = embedded?.instanceOf(HTMLElement) ? embedded : mermaidEl;

		if (!this.isEligibleMermaid(mermaidEl)) {
			this.removeZoomChrome(host);
			return;
		}

		host.addClass(TOOLBAR_HOST_CLASS);

		let toolbar = host.querySelector(`:scope > .${TOOLBAR_CLASS}`);
		if (!toolbar?.instanceOf(HTMLElement)) {
			toolbar = createDiv({ cls: TOOLBAR_CLASS });
			const existingEdit = host.querySelector(":scope > .edit-block-button");
			if (existingEdit) {
				existingEdit.before(toolbar);
			} else {
				host.appendChild(toolbar);
			}
		}

		let zoomBtn = toolbar.querySelector(`:scope > .${ZOOM_BTN_CLASS}`);
		if (!zoomBtn?.instanceOf(HTMLButtonElement)) {
			const button = createEl("button", {
				type: "button",
				cls: `${ZOOM_BTN_CLASS} clickable-icon`,
				title: "Open Mermaid lightbox",
				attr: { "aria-label": "Open Mermaid lightbox" },
			});
			setIcon(button, "zoom-in");
			button.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				if (this.isEligibleMermaid(mermaidEl)) {
					void this.lightbox.open(mermaidEl);
				}
			});
			toolbar.insertBefore(button, toolbar.firstChild);
			zoomBtn = button;
		}

		const editBtn = host.querySelector(".edit-block-button");
		if (editBtn && editBtn.parentElement !== toolbar) {
			toolbar.appendChild(editBtn);
		}
	}

	private removeZoomChrome(host: HTMLElement): void {
		const toolbar = host.querySelector(`:scope > .${TOOLBAR_CLASS}`);
		if (!toolbar) {
			host.removeClass(TOOLBAR_HOST_CLASS);
			host.querySelector(`:scope > .${ZOOM_BTN_CLASS}`)?.remove();
			return;
		}
		const editBtn = toolbar.querySelector(".edit-block-button");
		if (editBtn) {
			toolbar.before(editBtn);
		}
		toolbar.remove();
		host.removeClass(TOOLBAR_HOST_CLASS);
	}

	private annotateMermaidSources(
		root: HTMLElement,
		ctx?: MarkdownPostProcessorContext,
	): void {
		const sectionSource = mermaidSourceFromSection(ctx?.getSectionInfo(root)?.text);
		const blocks = root.querySelectorAll(".mermaid");
		for (const block of Array.from(blocks)) {
			if (!block.instanceOf(HTMLElement)) continue;
			const el = block;
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

		const target = evt.targetNode;
		if (!target?.instanceOf(Element)) return;

		const zoomBtn = target.closest(`.${ZOOM_BTN_CLASS}`);
		if (zoomBtn) {
			const host = zoomBtn.closest(`${EMBED_HOST_SELECTOR}, .mermaid`);
			let mermaidEl: HTMLElement | null = null;
			if (host?.instanceOf(HTMLElement) && host.matches(".mermaid")) {
				mermaidEl = host;
			} else if (host) {
				const nested = host.querySelector(".mermaid");
				mermaidEl = nested?.instanceOf(HTMLElement) ? nested : null;
			}
			if (!mermaidEl) {
				const closestMermaid = zoomBtn.closest(".mermaid");
				mermaidEl = closestMermaid?.instanceOf(HTMLElement) ? closestMermaid : null;
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

		const diagram = target.closest(".mermaid");
		const mermaidEl = diagram?.instanceOf(HTMLElement) ? diagram : null;
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

	override async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		if (key === "enableLivePreview") this.plugin.applyLivePreviewClass();
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Enable in Live Preview (editing mode)",
				desc: "When on, rendered Mermaid diagrams in Live Preview show a zoom-in cursor and a top-right magnify button, and clicking opens the lightbox (same idea as images). Reading view is always enabled.",
				control: { type: "toggle", key: "enableLivePreview" },
			},
			{
				type: "group",
				heading: "Backup",
				items: [
					{
						name: "Export settings",
						desc: "Download the current configuration as JSON.",
						action: () => {
							downloadSettingsJson(this.plugin.settings, "mermaid-lumina-settings.json");
						},
					},
					{
						name: "Import settings",
						desc: "Replace the current configuration from a JSON file.",
						action: () => {
							this.importSettings();
						},
					},
				],
			},
		];
	}

	private importSettings(): void {
		pickSettingsFile((text) => {
			try {
				const next = parseSettingsJson(text, normalizeSettings);
				applyImportedSettings(this.plugin.settings, next);
				void this.plugin.saveSettings().then(
					() => {
						this.plugin.applyLivePreviewClass();
						this.update();
						new Notice("Mermaid lumina settings imported");
					},
					() => {
						new Notice("Could not import settings");
					},
				);
			} catch (err) {
				new Notice(err instanceof Error ? err.message : "Could not import settings");
			}
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
