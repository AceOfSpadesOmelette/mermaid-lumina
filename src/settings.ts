export interface MermaidLuminaSettings {
	enableLivePreview: boolean;
}

export const DEFAULT_SETTINGS: MermaidLuminaSettings = {
	enableLivePreview: true,
};

export function normalizeSettings(raw: unknown): MermaidLuminaSettings {
	const data = (raw ?? {}) as Partial<MermaidLuminaSettings>;
	return {
		enableLivePreview:
			typeof data.enableLivePreview === "boolean"
				? data.enableLivePreview
				: DEFAULT_SETTINGS.enableLivePreview,
	};
}
