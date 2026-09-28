import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: { alias: { "@shared": fileURLToPath(new URL("./shared", import.meta.url)) } },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "مركز أبي بن كعب",
        short_name: "أبي بن كعب",
        description: "مركز أبي بن كعب لتعليم وتحفيظ القرآن الكريم والسنة النبوية",
        lang: "ar",
        dir: "rtl",
        start_url: "/",
        display: "standalone",
        background_color: "#faf7ef",
        theme_color: "#053d24",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        importScripts: ["/push-sw.js"],
        globPatterns: ["**/*.{js,css,html,png,webp,woff,woff2,webmanifest}"]
      }
    })
  ],
  server: { host: true, port: 5173, proxy: { "/api": "http://127.0.0.1:8787" } },
  test: { include: ["tests/**/*.test.ts"] }
});
