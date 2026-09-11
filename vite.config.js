import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Saturday Slate",
        short_name: "Slate",
        description: "Weekly football picks for your group.",
        theme_color: "#0c2318",
        background_color: "#0c2318",
        display: "standalone",
        icons: [],
      },
    }),
  ],
});
