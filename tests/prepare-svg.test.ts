import {
	extractMermaidSource,
	normalizeSvgSizing,
} from "../src/prepare-svg";

describe("extractMermaidSource", () => {
	it("reads data-lumina-source", () => {
		const el = document.createElement("div");
		el.setAttribute("data-lumina-source", "graph TD; A-->B");
		expect(extractMermaidSource(el)).toBe("graph TD; A-->B");
	});

	it("reads dataset keys", () => {
		const el = document.createElement("div");
		el.dataset.mermaidSource = "flowchart LR; X-->Y";
		expect(extractMermaidSource(el)).toBe("flowchart LR; X-->Y");
	});

	it("reads nested code text", () => {
		const el = document.createElement("div");
		const code = document.createElement("code");
		code.textContent = "sequenceDiagram\nA->>B: hi";
		el.appendChild(code);
		expect(extractMermaidSource(el)).toBe("sequenceDiagram\nA->>B: hi");
	});

	it("returns null when nothing found", () => {
		expect(extractMermaidSource(document.createElement("div"))).toBeNull();
	});
});

describe("normalizeSvgSizing", () => {
	it("applies pixel style sizing from viewBox", () => {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 200 100");
		svg.setAttribute("width", "200");
		svg.setAttribute("height", "100");
		// jsdom getBBox is missing; measure falls back to attributes / defaults
		const size = normalizeSvgSizing(svg, svg);
		expect(size.width).toBeGreaterThan(0);
		expect(size.height).toBeGreaterThan(0);
		expect(svg.style.width).toMatch(/px$/);
		expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
	});
});
