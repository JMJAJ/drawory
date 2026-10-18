import { defineConfig } from "@neon/config/v1";

function allowedOrigins() {
  const extra = (process.env.APP_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  // The always-on site; add more (a tunnel, your own domain) through APP_ORIGINS.
  return [...new Set(["http://localhost:3000", "https://drawory.vercel.app", ...extra])];
}

export default defineConfig({
  // Declare your Neon services here
  auth: false,
  // Live SQL queries power the shared board, cursors and signals. Browsers may only connect
  // from these addresses. Put your site's address(es) in APP_ORIGINS (comma separated, e.g.
  // "https://drawory.example.com,http://192.168.1.20:3000") and run `neon deploy` again.
  // From any other address the board still works, syncing every second instead of instantly.
  preview: { realtime: { allowedOrigins: allowedOrigins() } },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
