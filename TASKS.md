# Future Enhancements & Backlog

### [Infrastructure] TURN Server Integration for Strict NAT/VPN Penetration
**Context:** Currently, the application relies solely on public Google and Cloudflare STUN servers for WebRTC connection establishment. While this works for most standard networks, peers behind strict enterprise firewalls, Symmetric NATs, or VPNs (like WireGuard or Proton VPN) often experience connection timeouts due to blocked UDP hole-punching.
**Task:**
* Deploy a reliable, self-hosted Coturn (TURN) server.
* Add the TURN server credentials (URL, username, credential) to the `iceServers` array in the `providerOpts` configuration within `app.js`.
* Ensure fallback mechanisms gracefully degrade to STUN if TURN is unavailable.

### [UX] Keyboard Shortcuts & Timeline Navigation
**Context:** Researchers analysing micro-interactions need to navigate the media timeline rapidly without constantly using the mouse.
**Task:**
* Implement global keyboard listeners for common media controls:
  * `Spacebar` to toggle Play/Pause.
  * `Arrow Left` / `Arrow Right` to seek backward/forward by small increments (e.g., 0.5s or 1s).
  * `Shift + Arrow` for larger seek jumps.
* Ensure shortcuts are disabled when the user is actively typing inside the Tiptap editor or comment input fields to avoid accidental timeline jumps.

### [Feature] Advanced Export Formats (e.g., PDF or ELAN compatibility)
**Context:** While the application successfully exports to rich Word (`.docx`) files with marginal comments and annotated `.json` for native re-import, researchers often require static distribution formats or compatibility with legacy linguistic tools.
**Task:**
* Investigate exporting the synchronized transcript and comments into a clean PDF layout for immediate printing or archiving.
* Explore a conversion utility to export the data session back into `.eaf` (ELAN Annotation Format) or `.cha` (CLAN/TalkBank), preserving overlapping speech markers (`⌈`) and speaker tiers.