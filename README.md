# EMCA Data Session Explorer

**Idea and Architecture by:** Alexander Efremov (alexander@efremov-systems.com)

A buildless, client-side web application designed specifically for Ethnomethodology and Conversation Analysis (EMCA) data sessions. This tool allows researchers to analyse audio/video fragments locally without uploading sensitive research data to any external servers, ensuring strict privacy compliance (e.g., GDPR/DSGVO).

## Live Demo
Run the application directly in your browser without installation:
**[https://alef1986.github.io/emca-data-session-explorer/](https://alef1986.github.io/emca-data-session-explorer/)**

## Acknowledgements
This tool was conceptualised and developed as part of the human interface architecture research project at **[Efremov Systems](https://efremov-systems.com/societal/)**.

## Features
* **100% Client-Side Audio Processing:** Media files never leave your machine.
* **Real-Time P2P Collaboration (Beta):** Sync transcripts, bookmarks, and analytical notes with colleagues in real time via end-to-end encrypted WebRTC (no central database required).
* **Interactive Waveform & Spectrogram:** Visualise pitch, overlapping speech, and micro-pauses using open-source audio visualisation libraries.
* **Smart Synchronisation:** Click a transcript line to jump to the exact millisecond, or watch the transcript auto-scroll seamlessly as the media plays.
* **Loop Mode:** Draw a region directly on the waveform to continuously loop a specific conversational fragment.
* **Analytical Bookmarks & Colour Tags:** Bookmark lines, assign colour codes to specific speakers or phenomena, add analytical notes directly in the interface, and export the consolidated JSON.
* **Bilingual Interface:** Toggle between English and Russian instantly.

## Modes of Operation
When launching the player, you can choose between three workflows depending on your session type:

### 1. Solo Work (Local)
Fully offline mode for individual analysis. Load your media file and transcript JSON. No network connection is used, and the session runs entirely in your local browser memory.

### 2. Create Room (Host) — *In Testing*
Start a collaborative session. You must load your local media file and the base transcript `.json` file, then create a secret Room Name (password). The application establishes a secure Peer-to-Peer (P2P) session for colleagues to join.

### 3. Join Room (Guest) — *In Testing*
Join an existing collaborative session. You must load *only your local copy of the media file* and enter the Room Name provided by the host. The transcript, notes, and colour tags will sync automatically from the host in milliseconds.

> **Note on Collaborative Mode (Beta):** The P2P collaboration feature is currently in active testing. It utilises Yjs and WebRTC to sync text data directly between browsers. For strict privacy and performance reasons, **your audio/video files are never transmitted over the network**. Every participant must have a local copy of the media file on their own device to participate in a shared session.

## Input JSON Structure (For Solo & Host Modes)
The application expects a base transcript file in JSON format. It must be an array of objects representing individual lines or utterances, following this exact structure:

```json
[
  {
    "id": 1,
    "start": 0.0,
    "end": 2.2,
    "text": "Right, hello.",
    "is_bookmarked": false
  },
  {
    "id": 2,
    "start": 2.5,
    "end": 4.1,
    "text": "This is the original speech with um and uh.",
    "is_bookmarked": false
  }
]
```

### Field Reference
* `id` (Integer): The sequential line number.
* `start` (Float): Start time in seconds (e.g., 2.5).
* `end` (Float): End time in seconds (e.g., 4.1).
* `text` (String): The transcribed text.
* `is_bookmarked` (Boolean): Must be set to `false` by default.

*(Note: The application will automatically append an empty `"note"` field to these objects internally when loaded into the player, allowing you to save your analysis later).*