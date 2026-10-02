import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    // Keep a single React instance for the client runtime and UI libraries.
    include: ["@base-ui/react", "@tanstack/react-form", "react", "react-dom"],
  },
  plugins: [
    vinext(),
    tailwindcss(),
    cloudflare({
      // The vinext worker entry runs in the RSC environment, with SSR as a child.
      viteEnvironment: {
        childEnvironments: ["ssr"],
        name: "rsc",
      },
    }),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
});
