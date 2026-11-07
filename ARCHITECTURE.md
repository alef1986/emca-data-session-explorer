# System Architecture

EMCA Data Session Explorer is built on a **local-first, buildless architecture**, prioritizing data sovereignty, real-time collaboration, and zero-dependency deployment.

## Core Technologies
* **UI Framework:** Vue 3 (Composition API) loaded via ESM.
* **Media Rendering:** WaveSurfer.js (v7) with Regions and Spectrogram plugins (Web Audio API).
* **Styling:** Tailwind CSS (via CDN).
* **Collaboration Engine:** Yjs (CRDT - Conflict-free Replicated Data Types) and `y-webrtc`.

## Network Topology & P2P Synchronization
The application utilizes a **Full Mesh WebRTC Topology**. 

When multiple researchers join a room, each browser establishes a direct, end-to-end encrypted (DTLS/SCTP) tunnel with every other participant. 
* **Data Flow:** The application's state (transcript highlights, notes, loop regions) is managed by `Y.Doc`. Changes are synchronized directly between peers via the WebRTC data channels.
* **Media:** Audio/Video files are intentionally *not* transmitted over the network. Each user must select the local media file on their machine.

## Signaling Server & STUN/TURN
To establish the P2P WebRTC tunnels across different networks and NATs, the application requires initial metadata exchange (Session Description Protocol/ICE candidates).

1. **Signaling Server:** 
   * The signaling server acts *only* as a temporary handshake broker. It routes the initial connection requests but **does not touch, read, or proxy the actual JSON data or media**.
   * *Deployment:* Public signaling servers (like `signaling.yjs.dev`) are for testing only and are often overloaded. For production, it is strictly required to deploy a custom `y-webrtc` signaling server. 
   * *Best Practice:* Host the Node.js signaling process behind a reverse proxy (e.g., Nginx, Caddy) using strict `Origin` header validation and a hidden path route to prevent unauthorized usage. Refer to the [Y-WebRTC Documentation](https://docs.yjs.dev/ecosystem/connection-provider/y-webrtc) for deployment guides.
2. **STUN Servers:** The application is hardcoded to use public Google and Cloudflare STUN servers to resolve external IP addresses for successful NAT traversal.