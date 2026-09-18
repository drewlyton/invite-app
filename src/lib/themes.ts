export type Theme = {
	id: string;
	fonts: {
		heading: string;
		body: string;
	};
	accent: string;
	heroBg: string;
	heroText: string;
	accentTextShadow?: string;
	stars: { color: string } | null;
	balloons: { colors: string[] } | null;
};

export const themes: Record<string, Theme> = {
	default: {
		id: "default",
		fonts: {
			heading: "ui-sans-serif, system-ui, sans-serif",
			body: "ui-sans-serif, system-ui, sans-serif",
		},
		accent: "#1c1917",
		heroBg: "transparent",
		heroText: "#1c1917",
		stars: null,
		balloons: null,
	},
	"game-night": {
		id: "game-night",
		fonts: {
			heading: '"Press Start 2P", monospace',
			body: '"VT323", monospace',
		},
		accent: "#fde047",
		heroBg: "#0c1e3e",
		heroText: "#ffffff",
		accentTextShadow: "4px 4px 0 rgba(0,0,0,0.45)",
		stars: { color: "#ffffff" },
		balloons: null,
	},
	"game-night-light": {
		id: "game-night-light",
		fonts: {
			heading: '"Press Start 2P", monospace',
			body: '"VT323", monospace',
		},
		accent: "#1c1917",
		heroBg: "#ffffff",
		heroText: "#1c1917",
		accentTextShadow: "4px 4px 0 rgba(0,0,0,0.12)",
		stars: { color: "#44403c" },
		balloons: null,
	},
	birthday: {
		id: "birthday",
		fonts: {
			heading:
				"ui-rounded, 'Hiragino Maru Gothic ProN', 'Quicksand', system-ui, sans-serif",
			body: "ui-rounded, 'Hiragino Maru Gothic ProN', 'Quicksand', system-ui, sans-serif",
		},
		accent: "#db2777",
		heroBg: "#fff5f7",
		heroText: "#1c1917",
		stars: null,
		balloons: {
			colors: [
				"#fbcfe8", // pink-200
				"#bbf7d0", // green-200 (mint)
				"#bae6fd", // sky-200
				"#ddd6fe", // violet-200 (lavender)
				"#fed7aa", // orange-200 (peach)
			],
		},
	},
};

export function resolveTheme(id: string | undefined): Theme {
	return themes[id ?? "default"] ?? themes.default;
}
