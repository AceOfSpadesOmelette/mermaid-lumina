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
 * Clone an SVG and bake computed paint/font styles into attributes so theme
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
			// Prefer attributes for SVG presentation so they survive isolation.
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

interface SvgBounds {
	width: number;
	height: number;
	x: number;
	y: number;
}

function measureSvgBounds(svg: SVGSVGElement): SvgBounds {
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

	const vb = svg.viewBox?.baseVal;
	if (vb && vb.width > 0 && vb.height > 0) {
		return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
	}

	const attrW = parseFloat(svg.getAttribute("width") || "");
	const attrH = parseFloat(svg.getAttribute("height") || "");
	if (attrW > 0 && attrH > 0) {
		return { x: 0, y: 0, width: attrW, height: attrH };
	}

	const rect = svg.getBoundingClientRect();
	if (rect.width > 0 && rect.height > 0) {
		return { x: 0, y: 0, width: rect.width, height: rect.height };
	}

	return { x: 0, y: 0, width: 800, height: 600 };
}

/**
 * Size SVG to its content bounds with explicit px dimensions (no 100% letterboxing).
 */
export function normalizeSvgSizing(
	target: SVGSVGElement,
	measureFrom: SVGSVGElement = target,
): { width: number; height: number } {
	const bounds = measureSvgBounds(measureFrom);
	const width = Math.max(1, bounds.width);
	const height = Math.max(1, bounds.height);

	target.setAttribute(
		"viewBox",
		`${bounds.x} ${bounds.y} ${width} ${height}`,
	);
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

const LABEL_PAD = 6;

/**
 * Widen node boxes whose labels overflow (Android font metrics / leftover clip).
 */
export function expandClippedLabels(svg: SVGSVGElement): void {
	for (const fo of Array.from(svg.querySelectorAll("foreignObject"))) {
		const foEl = fo as SVGForeignObjectElement;
		const inner = foEl.querySelector("div, span, p") as HTMLElement | null;
		if (!inner) continue;
		const needW = Math.max(inner.scrollWidth, inner.offsetWidth, inner.clientWidth);
		const needH = Math.max(inner.scrollHeight, inner.offsetHeight, inner.clientHeight);
		const curW =
			parseFloat(foEl.getAttribute("width") || "") || foEl.width.baseVal.value;
		const curH =
			parseFloat(foEl.getAttribute("height") || "") || foEl.height.baseVal.value;
		const extraW = Math.max(0, needW + LABEL_PAD - curW);
		const extraH = Math.max(0, needH + LABEL_PAD - curH);
		if (extraW < 0.5 && extraH < 0.5) continue;
		foEl.setAttribute("width", String(curW + extraW));
		foEl.setAttribute("height", String(curH + extraH));
		growParentNodeBox(foEl, extraW, extraH);
	}

	for (const text of Array.from(svg.querySelectorAll("text"))) {
		const textEl = text as SVGTextElement;
		try {
			const tb = textEl.getBBox();
			if (tb.width <= 0) continue;
			const host =
				textEl.closest("g.node, g.cluster, g.actor") ?? textEl.parentElement;
			if (!host) continue;
			const rect = host.querySelector(":scope > rect");
			if (!(rect instanceof SVGRectElement)) continue;
			const rx = parseFloat(rect.getAttribute("x") || "0");
			const ry = parseFloat(rect.getAttribute("y") || "0");
			const rw = parseFloat(rect.getAttribute("width") || "0");
			const rh = parseFloat(rect.getAttribute("height") || "0");
			if (rw <= 0 || rh <= 0) continue;
			const extraW = Math.max(
				0,
				tb.x + tb.width + LABEL_PAD - (rx + rw),
				rx + LABEL_PAD - tb.x,
			);
			const extraH = Math.max(
				0,
				tb.y + tb.height + LABEL_PAD - (ry + rh),
				ry + LABEL_PAD - tb.y,
			);
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

function growParentNodeBox(from: Element, extraW: number, extraH: number): void {
	const node = from.closest("g.node, g.cluster, g.actor, g.statediagram-state");
	if (!node) return;
	const rect = node.querySelector(":scope > rect");
	if (!(rect instanceof SVGRectElement)) return;
	const x = parseFloat(rect.getAttribute("x") || "0");
	const y = parseFloat(rect.getAttribute("y") || "0");
	const w = parseFloat(rect.getAttribute("width") || "0");
	const h = parseFloat(rect.getAttribute("height") || "0");
	if (w <= 0) return;
	rect.setAttribute("width", String(w + extraW));
	rect.setAttribute("x", String(x - extraW / 2));
	rect.setAttribute("height", String(h + extraH));
	rect.setAttribute("y", String(y - extraH / 2));
}

/**
 * After the SVG is in the DOM, expand clipped labels then retighten sizing.
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

	// Obsidian sometimes keeps a <code> or pre sibling nearby
	const code = mermaidEl.querySelector("code");
	if (code?.textContent?.trim()) {
		const text = code.textContent.trim();
		if (!text.startsWith("<")) return text;
	}

	// Walk previous siblings for a language-mermaid code block remnant
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
		flowchart: { htmlLabels: true, useMaxWidth: false, wrappingWidth: 9999 },
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

	// Remove temporary render nodes Mermaid may leave in <body>
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
