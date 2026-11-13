// @ts-check

import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
	// Canonical origin. The printed invite's QR code is built from it, so a
	// sheet printed from a dev server or a preview host still points guests at
	// the real site instead of at localhost.
	site: "https://events.drewlyton.com",

	output: "server",

	adapter: node({
		mode: "standalone",
	}),

	vite: {
		plugins: [tailwindcss()],
		server: {
			// Allow the dev server to respond when reached via tailscale serve / funnel,
			// where the Host header carries the tailnet hostname (e.g. vps.tail9b3b6.ts.net)
			// rather than localhost.
			allowedHosts: true,
		},
	},

	integrations: [react()],
});
