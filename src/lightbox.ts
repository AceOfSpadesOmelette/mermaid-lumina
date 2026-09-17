import { setIcon } from "obsidian";
import { GestureController, type TransformState } from "./gestures";
import {
	prepareMermaidForLightbox,
	retightenSvgInDom,
	wrapInWhiteCanvas,
} from "./prepare-svg";

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const STEP = 0.25;
const CLICK_MOVE_THRESHOLD = 8;

/**
 * Fullscreen Mermaid lightbox with white canvas and mobile-friendly gestures.
 */
export class MermaidLuminaLightbox {
	private overlay: HTMLElement | null = null;
	private stage: HTMLElement | null = null;
	private content: HTMLElement | null = null;
	private zoomInput: HTMLInputElement | null = null;
	private gestures: GestureController | null = null;
	private state: TransformState = { scale: 1, tx: 0, ty: 0 };
	private fitScale = 1;
	private naturalWidth = 800;
	private naturalHeight = 600;
	private keyHandler: ((e: KeyboardEvent) => void) | null = null;
	private opened = false;
	private pointerDownPos: { x: number; y: number } | null = null;
	private pointerMoved = false;

	get isOpen(): boolean {
		return this.opened;
	}

	async open(mermaidEl: HTMLElement): Promise<void> {
		this.closeImmediate();

		const prepared = await prepareMermaidForLightbox(mermaidEl);
		if (!prepared) return;

		this.naturalWidth = prepared.width;
		this.naturalHeight = prepared.height;

		this.overlay = document.createElement("div");
		this.overlay.className = "mermaid-lumina-overlay";
		this.overlay.setAttribute("role", "dialog");
		this.overlay.setAttribute("aria-modal", "true");
		this.overlay.setAttribute("aria-label", "Mermaid diagram lightbox");

		const hint = document.createElement("div");
		hint.className = "mermaid-lumina-hint";
		hint.textContent =
			"Pinch or scroll to zoom · Drag to pan · Click outside to close";
		this.overlay.appendChild(hint);

		this.stage = document.createElement("div");
		this.stage.className = "mermaid-lumina-stage";

		const panel = wrapInWhiteCanvas(prepared.svg);
		this.content = panel;
		this.stage.appendChild(panel);
		this.overlay.appendChild(this.stage);
		this.overlay.appendChild(this.buildControls());

		this.bindOutsideClose();

		document.body.appendChild(this.overlay);
		document.body.classList.add("mermaid-lumina-open");
		this.opened = true;

		this.keyHandler = (e: KeyboardEvent) => {
			if (!this.opened) return;
			const typing =
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement;

			if (e.key === "Escape") {
				e.preventDefault();
				this.close();
				return;
			}

			// Don't steal typing shortcuts while editing the zoom field
			if (typing) return;

			if (e.key === "+" || e.key === "=") {
				e.preventDefault();
				this.zoomBy(STEP);
			} else if (e.key === "-" || e.key === "_") {
				e.preventDefault();
				this.zoomBy(-STEP);
			} else if (e.key === "0" || e.key.toLowerCase() === "r") {
				e.preventDefault();
				this.resetView();
			}
		};
		document.addEventListener("keydown", this.keyHandler);

		requestAnimationFrame(() => {
			this.overlay?.classList.add("is-active");
			this.retightenAndFit();
			this.bindGestures();
		});
	}

	/** Re-measure SVG in DOM (getBBox), hug white canvas, then fit to stage. */
	private retightenAndFit(): void {
		if (!this.content) return;
		const svg = this.content.querySelector("svg");
		if (svg) {
			const size = retightenSvgInDom(svg);
			this.naturalWidth = size.width;
			this.naturalHeight = size.height;
		}
		// Clear any previous forced box so the canvas wraps the SVG
		this.content.style.width = "";
		this.content.style.height = "";
		this.fitToScreen();
	}

	close(): void {
		if (!this.overlay) {
			this.closeImmediate();
			return;
		}
		this.overlay.classList.remove("is-active");
		const el = this.overlay;
		window.setTimeout(() => {
			if (this.overlay === el) this.closeImmediate();
			else el.remove();
		}, 200);
	}

	private closeImmediate(): void {
		this.gestures?.destroy();
		this.gestures = null;
		if (this.keyHandler) {
			document.removeEventListener("keydown", this.keyHandler);
			this.keyHandler = null;
		}
		this.overlay?.remove();
		this.overlay = null;
		this.stage = null;
		this.content = null;
		this.zoomInput = null;
		this.pointerDownPos = null;
		this.pointerMoved = false;
		document.body.classList.remove("mermaid-lumina-open");
		this.opened = false;
		this.state = { scale: 1, tx: 0, ty: 0 };
	}

	private bindOutsideClose(): void {
		if (!this.overlay || !this.stage) return;

		const onPointerDown = (e: PointerEvent) => {
			if (e.button !== 0 && e.pointerType === "mouse") return;
			this.pointerDownPos = { x: e.clientX, y: e.clientY };
			this.pointerMoved = false;
		};

		const onPointerMove = (e: PointerEvent) => {
			if (!this.pointerDownPos) return;
			const dx = e.clientX - this.pointerDownPos.x;
			const dy = e.clientY - this.pointerDownPos.y;
			if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD) {
				this.pointerMoved = true;
			}
		};

		const onClick = (e: MouseEvent) => {
			const target = e.target;
			if (!(target instanceof Element)) return;
			if (target.closest(".mermaid-lumina-canvas")) return;
			if (target.closest(".mermaid-lumina-controls")) return;
			if (this.pointerMoved) return;
			this.close();
		};

		this.overlay.addEventListener("pointerdown", onPointerDown);
		this.overlay.addEventListener("pointermove", onPointerMove);
		this.overlay.addEventListener("click", onClick);
	}

	private buildControls(): HTMLElement {
		const bar = document.createElement("div");
		bar.className = "mermaid-lumina-controls";

		const zoomOut = this.iconButton("zoom-out", "Zoom out", () =>
			this.zoomBy(-STEP),
		);
		this.zoomInput = this.buildZoomInput();
		const zoomIn = this.iconButton("zoom-in", "Zoom in", () =>
			this.zoomBy(STEP),
		);
		const reset = this.iconButton("rotate-ccw", "Fit to screen", () =>
			this.resetView(),
		);
		const close = this.iconButton("x", "Close", () => this.close());
		close.classList.add("mermaid-lumina-close");

		bar.appendChild(zoomOut);
		bar.appendChild(this.zoomInput);
		bar.appendChild(zoomIn);
		bar.appendChild(reset);
		bar.appendChild(close);

		bar.addEventListener("click", (e) => e.stopPropagation());
		bar.addEventListener("pointerdown", (e) => e.stopPropagation());
		return bar;
	}

	private buildZoomInput(): HTMLInputElement {
		const input = document.createElement("input");
		input.type = "text";
		input.inputMode = "numeric";
		input.className = "mermaid-lumina-zoom-input";
		input.value = "100%";
		input.title = "Zoom percentage";
		input.setAttribute("aria-label", "Zoom percentage");
		input.autocomplete = "off";
		input.spellcheck = false;

		const apply = () => this.applyZoomInput();

		input.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter") {
				e.preventDefault();
				apply();
				input.blur();
			} else if (e.key === "Escape") {
				e.preventDefault();
				this.syncZoomInput();
				input.blur();
				this.close();
			}
		});
		input.addEventListener("keyup", (e) => e.stopPropagation());
		input.addEventListener("input", () => this.autosizeZoomInput());
		input.addEventListener("pointerdown", (e) => e.stopPropagation());
		input.addEventListener("click", (e) => e.stopPropagation());
		input.addEventListener("focus", () => {
			input.select();
		});
		input.addEventListener("blur", () => apply());
		input.addEventListener("change", () => apply());

		this.autosizeZoomInput(input);
		return input;
	}

	private applyZoomInput(): void {
		if (!this.zoomInput) return;
		const parsed = parseZoomPercent(this.zoomInput.value);
		if (parsed === null) {
			this.syncZoomInput();
			return;
		}
		const next = clamp(parsed, MIN_SCALE, MAX_SCALE);
		this.setZoomCentered(next);
		this.syncZoomInput();
	}

	private syncZoomInput(): void {
		if (!this.zoomInput) return;
		// Don't clobber while the user is mid-edit
		if (document.activeElement !== this.zoomInput) {
			this.zoomInput.value = `${Math.round(this.state.scale * 100)}%`;
		}
		this.autosizeZoomInput();
	}

	/** Grow the zoom field so values like "100%" / "800%" are never clipped. */
	private autosizeZoomInput(input: HTMLInputElement | null = this.zoomInput): void {
		if (!input) return;
		const sample = input.value || "100%";
		const chars = Math.max(5, sample.length + 1);
		input.style.width = `${chars}ch`;
	}

	private iconButton(
		icon: string,
		title: string,
		onClick: () => void,
	): HTMLButtonElement {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "mermaid-lumina-btn";
		btn.title = title;
		btn.setAttribute("aria-label", title);
		setIcon(btn, icon);
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			onClick();
		});
		return btn;
	}

	private bindGestures(): void {
		if (!this.stage) return;
		this.gestures?.destroy();
		this.gestures = new GestureController(this.stage, {
			minScale: MIN_SCALE,
			maxScale: MAX_SCALE,
			getState: () => this.state,
			setState: (s) => {
				this.state = s;
			},
			onChange: () => this.applyTransform(),
			onDoubleTap: () => this.toggleFitZoom(),
		});
	}

	private fitToScreen(): void {
		if (!this.stage || !this.content) return;

		// Hug-content: do not force a fixed canvas box (avoids letterboxed white gaps)
		this.content.style.width = "";
		this.content.style.height = "";
		this.state = { scale: 1, tx: 0, ty: 0 };
		this.applyTransform();

		const rect = this.content.getBoundingClientRect();
		const boxW = rect.width > 1 ? rect.width : this.naturalWidth;
		const boxH = rect.height > 1 ? rect.height : this.naturalHeight;
		const stagePad = 24;
		const availW = Math.max(40, this.stage.clientWidth - stagePad);
		const availH = Math.max(40, this.stage.clientHeight - stagePad);
		const sx = availW / boxW;
		const sy = availH / boxH;
		this.fitScale = Math.min(1, sx, sy);
		if (!Number.isFinite(this.fitScale) || this.fitScale <= 0) {
			this.fitScale = 1;
		}
		this.state = { scale: this.fitScale, tx: 0, ty: 0 };
		this.applyTransform();
	}

	private resetView(): void {
		this.retightenAndFit();
	}

	private toggleFitZoom(): void {
		const nearFit = Math.abs(this.state.scale - this.fitScale) < 0.05;
		if (nearFit) {
			this.state = {
				scale: Math.min(MAX_SCALE, this.fitScale * 2),
				tx: 0,
				ty: 0,
			};
		} else {
			this.state = { scale: this.fitScale, tx: 0, ty: 0 };
		}
		this.applyTransform();
	}

	private zoomBy(delta: number): void {
		const next = clamp(this.state.scale + delta, MIN_SCALE, MAX_SCALE);
		this.setZoomCentered(next);
	}

	private setZoomCentered(next: number): void {
		if (!this.stage) return;
		const rect = this.stage.getBoundingClientRect();
		this.gestures?.zoomAround(
			rect.left + rect.width / 2,
			rect.top + rect.height / 2,
			next,
		);
		if (!this.gestures) {
			this.state = { ...this.state, scale: next };
			this.applyTransform();
		}
	}

	private applyTransform(): void {
		if (!this.content) return;
		const { scale, tx, ty } = this.state;
		this.content.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
		this.syncZoomInput();
	}
}

/** Parse "150", "150%", "1.5" (as ratio if <= 8 and has decimal without %) into scale. */
function parseZoomPercent(raw: string): number | null {
	const text = raw.trim().replace(/\s+/g, "");
	if (!text) return null;

	const hasPercent = text.endsWith("%");
	const numStr = hasPercent ? text.slice(0, -1) : text;
	const n = Number(numStr);
	if (!Number.isFinite(n) || n <= 0) return null;

	// Bare integers / large numbers are percentages; small decimals without % are ratios
	if (hasPercent || n > MAX_SCALE || Number.isInteger(n)) {
		return n / 100;
	}
	return n;
}

function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}
