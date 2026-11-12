# EMCA Data Session Explorer

**Idea and Architecture by:** Alexander Efremov (alexander@efremov-systems.com)

A buildless, client-side web application designed specifically for Ethnomethodology and Conversation Analysis (EMCA) data sessions. This tool allows researchers to analyse audio/video fragments locally without uploading sensitive research data to any external servers, ensuring strict privacy compliance (e.g., GDPR/DSGVO).

## Live Demo
Run the application directly in your browser without installation:
**[https://alef1986.github.io/emca-data-session-explorer/](https://alef1986.github.io/emca-data-session-explorer/)**

## Acknowledgements
This tool was conceptualised and developed as part of the human interface architecture research project at **[Efremov Systems](https://efremov-systems.com/societal/)**.

## Features
* **Multi-modal Analysis:** Synchronized playback of audio or video files alongside interactive audio spectrograms. Includes native Picture-in-Picture (PiP) and video zooming capabilities.
* **P2P Collaboration:** Real-time synchronization of the continuous transcript, text colors, and nested analytical comments via WebRTC.
* **Privacy-First & Autosave:** Media files and transcript data never leave your local machine or your P2P mesh network. All edits are automatically saved to your browser's local database (IndexedDB) to prevent data loss.
* **Universal Format Support:** Natively imports and flattens `.vtt` (including MS Teams formats with speaker tags and speech overlaps), `.srt`, and Whisper `.json` (including word-level timestamps). 
* **Offline Merging:** Work solo while disconnected, export your edits, and propose them to the host later. The system mathematically merges asynchronous offline changes (CRDT).
* **Professional Export:** Export the annotated session back into a rich JSON v2.0 file, or generate a native MS Word (`.docx`) document where your annotations appear as marginal comments.
* **Speaker Anonymization:** Optional automatic masking of speaker names (e.g., "Speaker 1") during file import to maintain informant confidentiality.

## Getting Started

The application is buildless and runs directly in the browser using native ES modules. 

1. **Host a Session (Host)**
   * Enter your Name, a Room ID, and an optional Encryption Password.
   * Provide the Signaling Server URL.
   * Load the Media File (Audio or Video) and the Transcript File (`.json`, `.vtt`, or `.srt`).
   * *Optional:* Check the "Anonymize speaker names" box before importing.
   * Share the Room ID, Password, and Signaling Server URL with your peers.

2. **Join a Session (Guest)**
   * Enter your Name, the shared Room ID, Password, and Signaling Server URL.
   * Load the **Media File only** (the transcript and notes will automatically sync from the Host over the P2P network).
   * Propose your own offline `.json` edits to the host using the "Propose your edits" button.

3. **Solo Work (Local)**
   * Simply provide the Media File and the Transcript file. No internet connection or signaling server is required. Your work is continuously autosaved.

## Transcript Formats
The application natively accepts multiple formats:
* **MS Teams VTT:** Automatically extracts `<v Speaker>` tags and translates overlapping timestamps into CA overlap markers (`⌈`).
* **SRT:** Standard subtitle files. The app attempts to extract speakers formatted as `[Speaker]: Text`.
* **Whisper JSON:** Supports output from OpenAI Whisper and HuggingFace, leveraging word-level timestamps (`[{ word, start, end }]`) for precise click-to-seek navigation.
* **Session JSON (v2.0):** The native export format containing the CRDT state vector (`_yjs_state`), required for offline merging and restoring exact comment threads.