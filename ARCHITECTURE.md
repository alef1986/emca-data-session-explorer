# System Architecture

EMCA Data Session Explorer is built on a **local-first, buildless architecture**, prioritizing data sovereignty, real-time collaboration, and zero-dependency deployment.

## Core Technologies
* **UI Framework:** Vue 3 (Composition API) loaded via ESM.
* **Media Rendering:** WaveSurfer.js (v7) with Regions and Spectrogram plugins (Web Audio API), supporting native `<video>` element binding.
* **Rich Text Engine:** Tiptap & ProseMirror (via ESM) for continuous text editing, dynamic text coloring, and embedded comment marks.
* **Collaboration Engine:** Yjs (CRDT - Conflict-free Replicated Data Types) and `y-webrtc`.
* **Local Storage:** IndexedDB (via `y-indexeddb`) for robust, offline-capable autosaving.
* **Document Generation:** `docx` ESM library for client-side MS Word generation.
* **Styling:** Tailwind CSS (via CDN).

## Network Topology & P2P Synchronization
The application utilizes a **Full Mesh WebRTC Topology**. 

When multiple researchers join a room, each browser establishes a direct, end-to-end encrypted (DTLS/SCTP) tunnel with every other participant. 
* **Data Flow:** The application's state (continuous transcript text, speaker names, text colors, overlapping comments, loop regions) is managed by `Y.Doc`. Changes are synchronized directly between peers via the WebRTC data channels in real-time.
* **Media:** Audio/Video files are intentionally *not* transmitted over the network. Each user must select the local media file on their machine.

## Offline Capabilities & CRDT Merging
The application strictly enforces a local-first philosophy, utilizing CRDT mathematics to resolve asynchronous work:
1. **Autosave:** All interactions are continuously persisted to the browser's IndexedDB. If a session drops or a browser is closed, work is safely restored upon reopening.
2. **Offline Proposals:** Peers can work on the transcript completely offline, saving their state as a v2.0 JSON file (containing the encoded `_yjs_state`). Upon rejoining a session, they can propose this file. The host previews the merge, and `Y.applyUpdate` mathematically resolves the offline divergences (insertions, colored text, new comment replies) seamlessly without duplicating unchanged data.

## Universal Parsing Pipeline
The application natively handles complex transcript formats without backend processing. Incoming files (`.vtt`, `.srt`, `.json`) are parsed, stripped of HTML artifacts, and chronologically flattened. Speaker overlaps (e.g., overlapping start/end times in MS Teams VTTs) are automatically detected and formatted with conversational analysis overlap markers (`⌈`) to ensure accurate representation in the continuous rich-text document.

## Signaling Server & STUN/TURN
To establish the P2P WebRTC tunnels across different networks and NATs, the application requires initial metadata exchange (Session Description Protocol/ICE candidates).

1. **Signaling Server:** 
   * The signaling server acts *only* as a temporary handshake broker. It routes the initial connection requests but **does not touch, read, or proxy the actual JSON data or media**.
   * *Deployment:* Public signaling servers (like `signaling.yjs.dev`) are for testing only and are often overloaded. For production, it is strictly required to deploy a custom `y-webrtc` signaling server behind a reverse proxy (e.g., Nginx, Caddy) using strict `Origin` header validation.
2. **STUN Servers:** The application is hardcoded to use public Google and Cloudflare STUN servers to resolve external IP addresses for successful NAT traversal.