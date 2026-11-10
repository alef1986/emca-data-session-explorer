# Future Enhancements & Backlog

### [Refactor] Split HTML Monolith into Native ES Modules
**Context:** The current `index.html` contains ~1500 lines of code, mixing templates, CSS, and complex Vue logic.
**Task:** 
* Extract Vue initialization and application logic into a dedicated `app.js`.
* Extract the internationalization dictionary into `i18n.js`.
* Move Tailwind configuration and custom CSS to `style.css`.
* Maintain the buildless philosophy by using `<script type="module" src="./app.js">` without introducing Webpack or Vite.

### [Feature] Integrate Video Player for Multi-modal Analysis
**Context:** EMCA methodology heavily relies on visual cues (gaze, gestures, UI interaction). Currently, only the audio track is extracted and rendered.
**Task:**
* Add an HTML5 `<video id="main-video">` element to the UI layout.
* Link the video element to WaveSurfer initialization using `media: document.getElementById('main-video')`.
* Ensure P2P sync and loop regions perfectly correlate with video frames alongside the audio spectrogram.

### [Architecture] Transition to Continuous Rich-Text (Y.Text)
**Context:** Users need the ability to select arbitrary parts of the transcript (e.g., across multiple original subtitle blocks) and attach analytical comments, similar to Microsoft Word or Google Docs. The current block-based JSON array prevents arbitrary text highlighting.
**Task:**
* Integrate a lightweight Rich-Text editor (e.g., Tiptap or ProseMirror).
* Migrate the Yjs data structure from a flat Map/Array to `Y.Text` to natively handle text indices and overlapping formatting.
* Implement a mechanism to map hidden timecode attributes (`data-start`, `data-end`) to the continuous text flow, enabling click-to-seek functionality.

### [Feature] Format Adapters & MS Teams VTT Support
**Context:** We need to support rich transcripts (like MS Teams VTTs containing speaker names) while maintaining backward compatibility with our legacy JSON format.
**Task:**
* Build an "Adapter Pipeline" for file uploads.
* Implement a `.vtt` parser that extracts timecodes, text, and `<v Speaker Name>` metadata.
* Ensure legacy `.json` uploads are dynamically converted into the unified internal AST (Abstract Syntax Tree) so both formats work seamlessly with the new continuous text engine.

### [Feature] Advanced Export/Import Integrity
**Context:** With the introduction of continuous text and overlapping notes, the export structure will become more complex.
**Task:**
* Ensure the "Save JSON" export function reliably captures `Y.Text` formatting markers.
* Implement a robust import merge strategy so users can re-upload an annotated JSON file into a session without overwriting base transcript data or duplicating existing bookmarks.

### [Feature] Offline CRDT State Merging (Asynchronous Collaboration)
**Context:** Researchers may work on the same base transcript independently while offline, resulting in two diverged files. We need a way to merge these files automatically without Git-style manual conflict resolution UI.
**Task:**
* Modify the "Save JSON" export logic to include the serialized CRDT state vector (`Y.encodeStateAsUpdate(ydoc)`) encoded as a Base64 string within the JSON payload.
* Modify the file drop/import logic to detect this `_yjs_state` field.
* If detected, decode the Base64 string and apply it using `Y.applyUpdate(ydoc, update)`.
* Rely on Yjs's inherent CRDT mathematical properties to automatically resolve concurrent offline edits and propagate the merged state seamlessly across the active WebRTC mesh.
