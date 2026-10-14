/** @type {import("jest").Config} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "jsdom",
	roots: ["<rootDir>/tests"],
	testMatch: ["**/*.test.ts"],
	moduleNameMapper: {
		"^obsidian$": "<rootDir>/__mocks__/obsidian.ts",
	},
	transform: {
		"^.+\\.tsx?$": [
			"ts-jest",
			{
				tsconfig: {
					module: "commonjs",
					esModuleInterop: true,
					isolatedModules: true,
				},
			},
		],
	},
};
