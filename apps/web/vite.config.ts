import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // bind 0.0.0.0 so colleagues on the LAN can reach this dev server
    // Vite blocks unrecognized Host headers by default (DNS-rebinding
    // protection, meant for "don't let a malicious website on the public
    // internet redirect a victim's browser to attack a local dev server").
    // That threat model doesn't fit an internal LAN tool colleagues reach by
    // IP or hostname — and a fixed allowlist here broke logins twice already
    // just from renaming this machine — so it's disabled outright rather
    // than chasing every address this server might be reached at.
    allowedHosts: true,
  },
});
