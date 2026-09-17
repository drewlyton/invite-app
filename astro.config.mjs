// @ts-check

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
	output: "server",

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
