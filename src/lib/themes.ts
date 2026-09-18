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
	},
};

export function resolveTheme(id: string | undefined): Theme {
	return themes[id ?? "default"] ?? themes.default;
}