import { parseSettingsJson, settingsToJson } from "../src/settings-io";
import { normalizeSettings } from "../src/settings";

describe("mermaid-lumina settings import", () => {
	it("round-trips the live preview flag", () => {
		const parsed = parseSettingsJson(
			settingsToJson({ enableLivePreview: false }),
			normalizeSettings,
		);
		expect(parsed.enableLivePreview).toBe(false);
	});

	it("defaults a missing flag", () => {
		const parsed = parseSettingsJson("{}", normalizeSettings);
		expect(parsed.enableLivePreview).toBe(true);
	});

	it("rejects non-objects", () => {
		expect(() => parseSettingsJson("[]", normalizeSettings)).toThrow(/JSON object/);
	});
});