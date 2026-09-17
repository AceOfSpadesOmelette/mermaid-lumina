import { Plugin } from "obsidian";
import { MermaidLuminaLightbox } from "./lightbox";

const VIEW_SELECTOR =
	".markdown-preview-view, .markdown-reading-view, .markdown-source-view";

const SOURCE_ATTR = "data-lumina-source";

export default class MermaidLuminaPlugin extends Plugin {
	private lightbox = new MermaidLuminaLightbox();

	onload(): void {
		// Preserve Mermaid source on rendered blocks when still available.
		this.registerMarkdownPostProcessor((el) => {
			this.annotateMermaidSources(el);
		});

		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			this.onDocumentClick(evt);
		});
	}

	onunload(): void {
		this.lightbox.close();
	}

	private annotateMermaidSources(root: HTMLElement): void {
		const blocks = root.querySelectorAll(".mermaid");
		for (const block of Array.from(blocks)) {
			const el = block as HTMLElement;
			if (el.getAttribute(SOURCE_ATTR)) continue;

			// Some renderers leave the source as a text node beside the SVG
			let source = "";
			for (const node of Array.from(el.childNodes)) {
				if (node.nodeType === Node.TEXT_NODE) {
					source += node.textContent ?? "";
				}
			}
			source = source.trim();
			if (source && !source.startsWith("<")) {
				el.setAttribute(SOURCE_ATTR, source);
				el.dataset.mermaidSource = source;
			}
		}
	}

	private onDocumentClick(evt: MouseEvent): void {
		if (this.lightbox.isOpen) return;

		const target = evt.target;
		if (!(target instanceof Element)) return;

		if (target.closest("a, button, input, textarea")) {
			return;
		}

		const mermaidEl = target.closest(".mermaid") as HTMLElement | null;
		if (!mermaidEl) return;
		if (!mermaidEl.querySelector("svg")) return;
		if (!this.isInNoteView(mermaidEl)) return;

		evt.preventDefault();
		evt.stopPropagation();
		void this.lightbox.open(mermaidEl);
	}

	private isInNoteView(el: HTMLElement): boolean {
		return Boolean(el.closest(VIEW_SELECTOR));
	}
}
