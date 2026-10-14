/**
 * Prepare a Mermaid SVG for lightbox display: white canvas + readable light colors.
 */

/** Paint/text props that are safe to bake. Skip font-size/family: computed
 *  values are CSS pixels from the in-note scale and clip labels in the lightbox. */
const STYLE_PROPS = [
	"fill",
	"stroke",
	"stroke-width",
	"stroke-dasharray",
	"stroke-linecap",
	"stroke-linejoin",
	"opacity",
	"fill-opacity",
	"stroke-opacity",
	"color",
	"font-weight",
	"font-style",
	"text-anchor",
	"dominant-baseline",
] as const;

/** CSS custom properties Mermaid / Obsidian commonly use for diagram colors. */
const LIGHT_THEME_VARS: Record<string, string> = {
	"--fg": "#333333",
	"--bg": "#ffffff",
	"--primary-color": "#333333",
	"--secondary-color": "#f4f4f4",
	"--tertiary-color": "#ffffff",
	"--primary-text-color": "#333333",
	"--secondary-text-color": "#333333",
	"--tertiary-text-color": "#333333",
	"--line-color": "#333333",
	"--text-color": "#333333",
	"--mainBkg": "#ECECFF",
	"--nodeBorder": "#9370DB",
	"--clusterBkg": "#FFFFDE",
	"--clusterBorder": "#AAAA33",
	"--titleColor": "#333333",
	"--edgeLabelBackground": "#ffffff",
	"--actorBkg": "#ECECFF",
	"--actorBorder": "#9370DB",
	"--actorTextColor": "#333333",
	"--actorLineColor": "#333333",
	"--signalColor": "#333333",
	"--signalTextColor": "#333333",
	"--labelBoxBkgColor": "#ECECFF",
	"--labelBoxBorderColor": "#9370DB",
	"--labelTextColor": "#333333",
	"--loopTextColor": "#333333",
	"--noteBkgColor": "#FFF5AD",
	"--noteTextColor": "#333333",
	"--noteBorderColor": "#AAAA33",
	"--activationBkgColor": "#f4f4f4",
	"--activationBorderColor": "#666666",
	"--sequenceNumberColor": "#ffffff",
};

const NO_MAX_WIDTH = { useMaxWidth: false } as const;

export interface PreparedMermaid {
	svg: SVGSVGElement;
	width: number;
	height: number;
}

function isUselessValue(value: string): boolean {
	const v = value.trim().toLowerCase();
	return (
		!v ||
		v === "none" ||
		v === "normal" ||
		v === "auto" ||
		v === "start" ||
		v === "rgba(0, 0, 0, 0)" ||
		v === "transparent"
	);
}

/**
 * Clone an SVG and bake computed paint styles into attributes so theme
 * CSS variables no longer control appearance after detachment from the note.
 */
export function cloneWithInlinedStyles(source: SVGSVGElement): SVGSVGElement {
	const clone = source.cloneNode(true) as SVGSVGElement;
	const srcEls = [source, ...Array.from(source.querySelectorAll<Element>("*"))];
	const dstEls = [clone, ...Array.from(clone.querySelectorAll<Element>("*"))];

	for (let i = 0; i < srcEls.length; i++) {
		const src = srcEls[i];
		const dst = dstEls[i];
		if (!src || !dst) continue;

		const cs = window.getComputedStyle(src);
		for (const prop of STYLE_PROPS) {
			const value = cs.getPropertyValue(prop);
			if (isUselessValue(value)) continue;
			if (dst instanceof SVGElement) {
				try {
					dst.setAttribute(prop, value.trim());
				} catch {
					/* ignore invalid attrs on some nodes */
				}
			}
		}

		// foreignObject HTML labels — keep original font-size/family (user units)
		if (src instanceof HTMLElement && dst instanceof HTMLElement) {
			dst.style.color = cs.color;
			dst.style.fontWeight = cs.fontWeight;
			dst.style.backgroundColor = cs.backgroundColor;
		}
	}

	applyLightThemeVars(clone);
	normalizeSvgSizing(clone, source);
	return clone;
}

function applyLightThemeVars(svg: SVGSVGElement): void {
	for (const [key, value] of Object.entries(LIGHT_THEME_VARS)) {
		svg.style.setProperty(key, value);
	}
	svg.style.color = "#333333";
	svg.style.background = "#ffffff";
}

const VIEWBOX_PAD = 8;
const LABEL_PAD = 6;
const MAX_NODE_GROW = 32;

interface SvgBounds {
	width: number;
	height: number;
	x: number;
	y: number;
}

function parseLength(raw: string | null): number | null {
	if (!raw) return null;
	const trimmed = raw.trim();
	if (!trimmed || trimmed.endsWith("%")) return null;
	const n = parseFloat(trimmed);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function isPercentSize(raw: string | null): boolean {
	return Boolean(raw?.trim().endsWith("%"));
}

/**
 * Prefer Mermaid's own viewBox / numeric width+height. Only fall back to
 * getBBox when the SVG is percentage-sized (would letterbox otherwise).
 */
function measureMermaidSize(svg: SVGSVGElement): SvgBounds {
	const attrW = parseLength(svg.getAttribute("width"));
	const attrH = parseLength(svg.getAttribute("height"));
	const vb = svg.viewBox?.baseVal;
	const hasViewBox = Boolean(vb && vb.width > 0 && vb.height > 0);
	const percentSized =
		isPercentSize(svg.getAttribute("width")) ||
		isPercentSize(svg.getAttribute("height"));

	if (hasViewBox && !percentSized) {
		return { x: vb!.x, y: vb!.y, width: vb!.width, height: vb!.height };
	}

	if (attrW && attrH && !percentSized) {
		if (hasViewBox) {
			return { x: vb!.x, y: vb!.y, width: vb!.width, height: vb!.height };
		}
		return { x: 0, y: 0, width: attrW, height: attrH };
	}

	// Percentage width/height (or missing sizes): content bounds via getBBox
	try {
		const box = svg.getBBox();
		if (box.width > 0 && box.height > 0) {
			return {
				x: box.x - VIEWBOX_PAD,
				y: box.y - VIEWBOX_PAD,
				width: box.width + VIEWBOX_PAD * 2,
				height: box.height + VIEWBOX_PAD * 2,
			};
		}
	} catch {
		/* not in DOM / empty */
	}

	if (hasViewBox) {
		return { x: vb!.x, y: vb!.y, width: vb!.width, height: vb!.height };
	}

	if (attrW && attrH) {
		return { x: 0, y: 0, width: attrW, height: attrH };
	}

	const rect = svg.getBoundingClientRect();
	if (rect.width > 0 && rect.height > 0) {
		return { x: 0, y: 0, width: rect.width, height: rect.height };
	}

	return { x: 0, y: 0, width: 800, height: 600 };
}

/**
 * Size SVG using Mermaid's own dimensions. Preserve the original viewBox
 * when present; only rewrite it when falling back to getBBox.
 */
export function normalizeSvgSizing(
	target: SVGSVGElement,
	measureFrom: SVGSVGElement = target,
): { width: number; height: number } {
	const bounds = measureMermaidSize(measureFrom);
	const width = Math.max(1, bounds.width);
	const height = Math.max(1, bounds.height);

	const existingVb = target.viewBox?.baseVal;
	const hasExistingVb =
		Boolean(existingVb && existingVb.width > 0 && existingVb.height > 0);
	const percentSized =
		isPercentSize(measureFrom.getAttribute("width")) ||
		isPercentSize(measureFrom.getAttribute("height")) ||
		isPercentSize(target.getAttribute("width")) ||
		isPercentSize(target.getAttribute("height"));

	// Only replace viewBox when Mermaid gave us percentage sizing (or none)
	if (!hasExistingVb || percentSized) {
		target.setAttribute(
			"viewBox",
			`${bounds.x} ${bounds.y} ${width} ${height}`,
		);
	}

	target.removeAttribute("width");
	target.removeAttribute("height");
	target.setAttribute("preserveAspectRatio", "xMidYMid meet");
	target.style.width = `${width}px`;
	target.style.height = `${height}px`;
	target.style.maxWidth = "none";
	target.style.maxHeight = "none";
	target.style.display = "block";
	return { width, height };
}

/**
 * Mild flowchart-only fix: widen g.node boxes when SVG text overflows.
 * Never touch g.actor / sequence / gantt geometry — foreignObject scroll
 * metrics are unreliable and inflate actor columns.
 */
export function expandClippedLabels(svg: SVGSVGElement): void {
	for (const text of Array.from(svg.querySelectorAll("g.node > text, g.node text"))) {
		const textEl = text as SVGTextElement;
		const host = textEl.closest("g.node");
		if (!host) continue;
		try {
			const tb = textEl.getBBox();
			if (tb.width <= 0) continue;
			const rect = host.querySelector(":scope > rect");
			if (!(rect instanceof SVGRectElement)) continue;
			const rx = parseFloat(rect.getAttribute("x") || "0");
			const ry = parseFloat(rect.getAttribute("y") || "0");
			const rw = parseFloat(rect.getAttribute("width") || "0");
			const rh = parseFloat(rect.getAttribute("height") || "0");
			if (rw <= 0 || rh <= 0) continue;

			let extraW = Math.max(
				0,
				tb.x + tb.width + LABEL_PAD - (rx + rw),
				rx + LABEL_PAD - tb.x,
			);
			let extraH = Math.max(
				0,
				tb.y + tb.height + LABEL_PAD - (ry + rh),
				ry + LABEL_PAD - tb.y,
			);
			extraW = Math.min(extraW, MAX_NODE_GROW);
			extraH = Math.min(extraH, MAX_NODE_GROW);
			if (extraW < 0.5 && extraH < 0.5) continue;

			rect.setAttribute("width", String(rw + extraW));
			rect.setAttribute("x", String(rx - extraW / 2));
			rect.setAttribute("height", String(rh + extraH));
			rect.setAttribute("y", String(ry - extraH / 2));
		} catch {
			/* getBBox throws if not rendered */
		}
	}
}

/**
 * After the SVG is in the DOM, optionally nudge flowchart nodes then re-apply
 * Mermaid-native sizing (no getBBox rewrite of sequence/gantt viewBoxes).
 */
export function retightenSvgInDom(
	svg: SVGSVGElement,
): { width: number; height: number } {
	expandClippedLabels(svg);
	return normalizeSvgSizing(svg, svg);
}

/**
 * Try to recover Mermaid source text from a rendered container.
 */
export function extractMermaidSource(mermaidEl: HTMLElement): string | null {
	const attr = mermaidEl.getAttribute("data-lumina-source");
	if (attr?.trim()) return attr.trim();

	const dataKeys = [
		"mermaidSource",
		"luminaSource",
		"source",
		"graph",
		"code",
		"original",
	];
	for (const key of dataKeys) {
		const val = mermaidEl.dataset[key];
		if (val && val.trim()) return val.trim();
	}

	const code = mermaidEl.querySelector("code");
	if (code?.textContent?.trim()) {
		const text = code.textContent.trim();
		if (!text.startsWith("<")) return text;
	}

	let prev = mermaidEl.previousElementSibling;
	while (prev) {
		if (
			prev.classList.contains("language-mermaid") ||
			prev.querySelector?.("code.language-mermaid")
		) {
			const text = prev.textContent?.trim();
			if (text) return text;
		}
		prev = prev.previousElementSibling;
	}

	return null;
}

interface MermaidApi {
	initialize?: (config: Record<string, unknown>) => void;
	render: (
		id: string,
		text: string,
	) => Promise<{ svg: string } | string> | { svg: string } | string;
}

function getMermaidApi(): MermaidApi | null {
	const w = window as unknown as { mermaid?: MermaidApi };
	if (w.mermaid && typeof w.mermaid.render === "function") {
		return w.mermaid;
	}
	return null;
}

/**
 * Prefer a fresh light-theme render; fall back to inlined clone of the on-page SVG.
 */
export async function prepareMermaidForLightbox(
	mermaidEl: HTMLElement,
): Promise<PreparedMermaid | null> {
	const existingSvg = mermaidEl.querySelector("svg");
	if (!existingSvg) return null;

	const sourceText = extractMermaidSource(mermaidEl);
	const api = getMermaidApi();

	if (sourceText && api) {
		try {
			const rendered = await renderLightMermaid(api, sourceText);
			if (rendered) {
				applyLightThemeVars(rendered);
				const size = normalizeSvgSizing(rendered, rendered);
				return { svg: rendered, ...size };
			}
		} catch (err) {
			console.warn("Mermaid Lumina: light re-render failed, using clone", err);
		}
	}

	const clone = cloneWithInlinedStyles(existingSvg as SVGSVGElement);
	const size = normalizeSvgSizing(clone, existingSvg as SVGSVGElement);
	return { svg: clone, ...size };
}

async function renderLightMermaid(
	api: MermaidApi,
	text: string,
): Promise<SVGSVGElement | null> {
	api.initialize?.({
		startOnLoad: false,
		securityLevel: "loose",
		theme: "default",
		// Keep KaTeX CSS math ($$…$$) when re-rendering; matches vault mermaid-math-config.
		forceLegacyMathML: true,
		flowchart: { htmlLabels: true, ...NO_MAX_WIDTH },
		sequence: { ...NO_MAX_WIDTH },
		gantt: { ...NO_MAX_WIDTH },
		class: { ...NO_MAX_WIDTH },
		state: { ...NO_MAX_WIDTH },
		er: { ...NO_MAX_WIDTH },
		journey: { ...NO_MAX_WIDTH },
		pie: { ...NO_MAX_WIDTH },
		gitGraph: { ...NO_MAX_WIDTH },
		mindmap: { ...NO_MAX_WIDTH },
		timeline: { ...NO_MAX_WIDTH },
		themeVariables: {
			darkMode: false,
			background: "#ffffff",
			fontFamily: "trebuchet ms, verdana, arial, sans-serif",
			fontSize: "16px",
			primaryTextColor: "#333333",
			secondaryTextColor: "#333333",
			tertiaryTextColor: "#333333",
			lineColor: "#333333",
			textColor: "#333333",
			mainBkg: "#ECECFF",
			nodeBorder: "#9370DB",
		},
	});

	const id = `mermaid-lumina-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
	const result = await Promise.resolve(api.render(id, text));
	const svgMarkup = typeof result === "string" ? result : result.svg;
	if (!svgMarkup) return null;

	const parser = new DOMParser();
	const doc = parser.parseFromString(svgMarkup, "image/svg+xml");
	const svg = doc.querySelector("svg");
	if (!svg) return null;

	document.getElementById(id)?.remove();
	document.getElementById(`d${id}`)?.remove();

	return svg as SVGSVGElement;
}

/** Wrap prepared SVG in a white panel for the lightbox stage. */
export function wrapInWhiteCanvas(svg: SVGSVGElement): HTMLElement {
	const panel = document.createElement("div");
	panel.className = "mermaid-lumina-canvas";
	panel.appendChild(svg);
	return panel;
}
