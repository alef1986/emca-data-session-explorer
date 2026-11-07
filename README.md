# EMCA Data Session Explorer

**Idea and Architecture by:** Alexander Efremov (alexander@efremov-systems.com)

A buildless, client-side web application designed specifically for Ethnomethodology and Conversation Analysis (EMCA) data sessions. This tool allows researchers to analyse audio/video fragments locally without uploading sensitive research data to any external servers, ensuring strict privacy compliance (e.g., GDPR/DSGVO).

## Live Demo
Run the application directly in your browser without installation:
**[https://alef1986.github.io/emca-data-session-explorer/](https://alef1986.github.io/emca-data-session-explorer/)**

## Acknowledgements
This tool was conceptualised and developed as part of the human interface architecture research project at **[Efremov Systems](https://efremov-systems.com/societal/)**.

## Features
* **Multi-modal Analysis:** Synchronized playback of media and interactive audio spectrograms.
* **P2P Collaboration:** Real-time synchronization of transcript navigation, highlights, and analytical notes via WebRTC.
* **Privacy-First:** Media files and transcript data never leave your local machine or your P2P mesh network. No centralized storage.
* **Local & Host/Join Modes:** Work fully offline in solo mode, or create a secure P2P room to invite peers.
* **Analytical Tools:** Frequency range adjustments, waveform looping, transcript autoscroll, and dynamic coloring.

## Getting Started

The application is buildless and runs directly in the browser using native ES modules. 

1. **Host a Session (Host)**
   * Enter your Name, a Room ID, and an optional Encryption Password.
   * Provide the Signaling Server URL.
   * Load the Media File (Audio/Video) and the Transcript File (`.json`).
   * Share the Room ID, Password, and Signaling Server URL with your peers.

2. **Join a Session (Guest)**
   * Enter your Name, the shared Room ID, Password, and Signaling Server URL.
   * Load the **Media File only** (the transcript and notes will automatically sync from the Host over the P2P network).

3. **Solo Work (Local)**
   * Simply provide the Media File and the Transcript JSON. No internet connection or signaling server is required.

## Transcript JSON Format
The application expects an array of objects for the transcript:
```json
[
  {
    "id": 1,
    "start": 0.5,
    "end": 3.2,
    "text": "Hello, colleagues.",
    "color": "",
    "note": "",
    "is_bookmarked": false
  }
]