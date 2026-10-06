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
	clouds: { color: string } | null;
	/**
	 * Opt in to a moon in the hero's top-right corner and the light it casts
	 * across that corner. `glow` is the colour of that light, painted as a radial
	 * gradient centred on the moon; the moon's own art lives in
	 * `public/moon/moon.svg`, which carries its own palette the way the pixel
	 * clouds do.
	 */
	moon: { glow: string } | null;
	/**
	 * Opt in to moving the date/time/location/RSVP block out of the hero and
	 * below the fold, leaving the hero as eyebrow + title + subtitle only.
	 */
	detailsBelowFold: boolean;
	runner: {
		color: string;
		ground?: string;
		/**
		 * The far end of the ground's vertical gradient: the tone at the bottom of
		 * the hero's ground band, which is also the tone the below-fold details
		 * section is painted in. Optional — without it the ground is one flat tone
		 * from `ground`, exactly as before this field existed.
		 */
		groundFar?: string;
		celebrateAt?: number;
		celebrationMessage?: string;
	} | null;
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
		clouds: null,
		moon: null,
		detailsBelowFold: false,
		runner: null,
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
		clouds: null,
		moon: null,
		detailsBelowFold: false,
		runner: null,
	},
	"game-night-light": {
		id: "game-night-light",
		fonts: {
			heading: '"Press Start 2P", monospace',
			body: '"VT323", monospace',
		},
		accent: "#1c1917",
		// stone-200, not white: the sky is all `game-night-light` has behind the
		// clouds, the star specks and the ground band, and a pure-white sky left the
		// dark player sprite floating on a bleached field. One step off white is
		// enough to seat the sprite without dimming the hero text on it, and the
		// cloud palette in `public/clouds/cloud-small.svg` is scaled by the same
		// factor so the clouds sit on the darker sky the way they sat on the white
		// one. Their contrast ratio does not hold exactly — scaling ink and paper by
		// the same factor cannot preserve a ratio — but nothing about how a cloud
		// reads depends on that.
		heroBg: "#e7e5e4",
		heroText: "#1c1917",
		accentTextShadow: "4px 4px 0 rgba(0,0,0,0.12)",
		stars: { color: "#44403c" },
		balloons: null,
		// A flag, not a colour: the pixel cloud in `public/clouds/cloud-small.svg`
		// carries its own three-tone palette, and nothing reads this value. It is
		// the cloud's mid tone rather than a sky tone so that wiring it up later
		// cannot silently land the clouds on the sky they sit against.
		clouds: { color: "#3e3a36" },
		// A near-white moon whose light is the hero's brightest point. `glow` is
		// mixed down to transparent in `Invite.astro` to make the radial falloff,
		// so it is the one colour here that has to stay light; the disc's own
		// palette is in `public/moon/moon.svg`.
		moon: { glow: "#ffffff" },
		detailsBelowFold: true,
		runner: {
			color: "#d6d3d1",
			// stone-600 is the ground's *ink*, not what the ground looks like: it is
			// painted at `GROUND_FILL_ALPHA` (0.45) over `heroBg`, which lands the
			// gradient's near end on ≈#a6a3a1 — a mid grey in the player sprite's value
			// family (the sprite's own pixels average ≈#46413d) and a long way from the
			// near-white the old stone-400 ink produced at 0.22. A step *lighter* than
			// the sprite, deliberately: equal values would swallow the figure it has to
			// stand on. Raising
			// the ink rather than the alpha alone is what makes the ground read as a
			// surface; see `src/lib/runner-ground.ts`.
			ground: "#57534e",
			// stone-300, the far end of the ground gradient: the band fades from the
			// stone-600 ink at the player's feet to this by the hero's bottom edge, so
			// the below-fold details sit on ≈#dfdddb (12.9:1 for `heroText`) instead of
			// on the flat mid grey's ≈#a6a3a1 (7.0:1).
			groundFar: "#d6d3d1",
		},
	},
	birthday: {
		id: "birthday",
		fonts: {
			heading: "'Playfair Display', 'Times New Roman', Georgia, serif",
			body: "Lora, Georgia, 'Times New Roman', serif",
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
		clouds: null,
		moon: null,
		detailsBelowFold: false,
		runner: null,
	},
};

export function resolveTheme(id: string | undefined): Theme {
	return themes[id ?? "default"] ?? themes.default;
}
