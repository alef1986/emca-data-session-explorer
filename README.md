# EMCA Data Session Explorer

**Idea and Architecture by:** Alexander Efremov (alexander@efremov-systems.com)

A buildless, client-side only web application designed specifically for Ethnomethodology and Conversation Analysis (EMCA) data sessions. This tool allows researchers to analyse audio/video fragments locally without uploading sensitive research data to any external servers, ensuring strict privacy compliance (e.g., GDPR/DSGVO).

## Live Demo
Run the application directly in your browser without installation:
**[https://alef1986.github.io/emca-data-session-explorer/](https://alef1986.github.io/emca-data-session-explorer/)**

## Acknowledgements
This tool was conceptualised and developed as part of the human interface architecture research project at **[Efremov Systems](https://efremov-systems.com/societal/)**.

## Features
* **100% Client-Side:** Runs entirely in the browser using the HTML5 File API. No backend, no server setup required.
* **Interactive Waveform & Spectrogram:** Visualise pitch, overlapping speech, and micro-pauses using open-source audio visualisation libraries.
* **Smart Synchronisation:** Click a transcript line to jump to the exact millisecond, or watch the transcript auto-scroll seamlessly as the media plays.
* **Loop Mode:** Select a start and end line to continuously loop a specific conversational fragment for detailed observation.
* **Analytical Bookmarks:** Bookmark specific lines, add analytical notes directly in the interface, and export/import them as a JSON file.
* **Bilingual Interface:** Toggle between English and Russian instantly.

## How to Use
1. Open the [Live Demo](https://alef1986.github.io/emca-data-session-explorer/) or download `index.html` locally.
2. Drag and drop your media file (`.mp3`, `.wav`, `.mp4`) and your base transcript `.json` file into the start screen.
3. Click "Start Player".

## Input JSON Structure
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