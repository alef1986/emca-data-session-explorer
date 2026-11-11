import { createApp, ref, computed, watch, nextTick, onUnmounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js';
import Spectrogram from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/spectrogram.esm.js';
import RegionsPlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/regions.esm.js';
import { dictionary, colorSwatches } from './i18n.js';

import { Editor, Mark, mergeAttributes } from 'https://esm.sh/@tiptap/core@2.2.4';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2.2.4';
import Collaboration from 'https://esm.sh/@tiptap/extension-collaboration@2.2.4?deps=yjs@13.6.18';
import CollaborationCursor from 'https://esm.sh/@tiptap/extension-collaboration-cursor@2.2.4?deps=yjs@13.6.18';
import TextAlign from 'https://esm.sh/@tiptap/extension-text-align@2.2.4';
import { IndexeddbPersistence } from 'https://esm.sh/y-indexeddb@9.0.12?deps=yjs@13.6.18';

export const decodeHtmlEntities = (str) => {
    if (!str || typeof str !== 'string') return '';
    let res = str;

    for (let i = 0; i < 2; i++) {
        if (!res.includes('&')) break;

        res = res
            .replace(/&#(\d+);?/g, (_, dec) => {
                const code = parseInt(dec, 10);
                if (!isNaN(code) && code > 0 && code <= 0x10FFFF) {
                    try { return String.fromCodePoint(code); } catch { return _; }
                }
                return _;
            })
            .replace(/&#x([0-9a-fA-F]+);?/gi, (_, hex) => {
                const code = parseInt(hex, 16);
                if (!isNaN(code) && code > 0 && code <= 0x10FFFF) {
                    try { return String.fromCodePoint(code); } catch { return _; }
                }
                return _;
            });

        if (typeof document !== 'undefined') {
            const txt = document.createElement('textarea');
            txt.innerHTML = res;
            res = txt.value;
        } else {
            const map = {
                '&nbsp;': ' ', '&quot;': '"', '&apos;': "'", '&amp;': '&',
                '&lt;': '<', '&gt;': '>', '&ccedil;': 'ç', '&Ccedil;': 'Ç',
                '&auml;': 'ä', '&Auml;': 'Ä', '&ouml;': 'ö', '&Ouml;': 'Ö',
                '&uuml;': 'ü', '&Uuml;': 'Ü', '&eacute;': 'é', '&Eacute;': 'É',
                '&egrave;': 'è', '&Egrave;': 'È', '&agrave;': 'à', '&Agrave;': 'À',
                '&ntilde;': 'ñ', '&Ntilde;': 'Ñ', '&iacute;': 'í', '&Iacute;': 'Í',
                '&oacute;': 'ó', '&Oacute;': 'Ó', '&uacute;': 'ú', '&Uacute;': 'Ú'
            };
            res = res.replace(/&[a-zA-Z0-9]+;/g, m => map[m] || m);
        }
    }

    return res.replace(/^[\uFEFF\u200B]+/, '');
};

export const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

export const parseTimestampToSeconds = (timeStr) => {
    if (typeof timeStr === 'number') {
        return isNaN(timeStr) ? 0 : timeStr;
    }
    if (!timeStr || typeof timeStr !== 'string') {
        return 0;
    }
    const clean = timeStr.trim().replace(',', '.');
    const parts = clean.split(':');
    if (parts.length === 3) {
        const hours = parseFloat(parts[0]);
        const minutes = parseFloat(parts[1]);
        const seconds = parseFloat(parts[2]);
        if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return 0;
        return hours * 3600 + minutes * 60 + seconds;
    } else if (parts.length === 2) {
        const minutes = parseFloat(parts[0]);
        const seconds = parseFloat(parts[1]);
        if (isNaN(minutes) || isNaN(seconds)) return 0;
        return minutes * 60 + seconds;
    } else if (parts.length === 1) {
        const sec = parseFloat(parts[0]);
        return isNaN(sec) ? 0 : sec;
    }
    return 0;
};

export const parseVttToSegments = (vttText) => {
    if (!vttText || typeof vttText !== 'string') return [];

    const segments = [];
    const normalized = vttText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalized.split(/\n\s*\n/);
    const timeRegex = /((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;

    for (const block of blocks) {
        const lines = block.split('\n');
        let timeIndex = -1;
        let timeMatch = null;

        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(timeRegex);
            if (m) {
                timeIndex = i;
                timeMatch = m;
                break;
            }
        }

        if (timeIndex === -1 || !timeMatch) continue;

        const start = parseTimestampToSeconds(timeMatch[1]);
        const end = parseTimestampToSeconds(timeMatch[2]);
        const rawContent = lines.slice(timeIndex + 1).join('\n').trim();
        if (!rawContent) continue;

        let speaker = null;
        let textContent = rawContent;

        const vMatch = rawContent.match(/<v\s+([^>]+)>([\s\S]*)/i);
        if (vMatch) {
            speaker = vMatch[1].trim();
            textContent = vMatch[2];
        }

        textContent = textContent
            .replace(/<\/v>/gi, ' ')
            .replace(/<[^>]+>/g, ' ');

        textContent = decodeHtmlEntities(textContent).replace(/^[⌈\uFEFF\u200B\s]+/, '').replace(/\s+/g, ' ').trim();
        speaker = speaker ? decodeHtmlEntities(speaker).replace(/^[⌈\uFEFF\u200B\s]+/, '').replace(/\s+/g, ' ').trim() : null;

        if (!textContent) continue;

        segments.push({
            start,
            end,
            text: textContent,
            speaker: speaker || null
        });
    }

    return segments;
};

export const parseSrtToSegments = (srtText) => {
    if (!srtText || typeof srtText !== 'string') return [];

    const segments = [];
    const normalized = srtText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalized.split(/\n\s*\n/);
    const timeRegex = /((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;

    for (const block of blocks) {
        const lines = block.split('\n');
        let timeIndex = -1;
        let timeMatch = null;

        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(timeRegex);
            if (m) {
                timeIndex = i;
                timeMatch = m;
                break;
            }
        }

        if (timeIndex === -1 || !timeMatch) continue;

        const start = parseTimestampToSeconds(timeMatch[1]);
        const end = parseTimestampToSeconds(timeMatch[2]);
        let rawContent = lines.slice(timeIndex + 1).join(' ').trim();
        if (!rawContent) continue;

        rawContent = rawContent
            .replace(/<[^>]+>/g, ' ');

        rawContent = decodeHtmlEntities(rawContent).replace(/^[⌈\uFEFF\u200B\s]+/, '').replace(/\s+/g, ' ').trim();

        if (!rawContent) continue;

        let speaker = null;
        let textContent = rawContent;

        const bracketMatch = textContent.match(/^\[([^\]]+)\]\s*:?\s*(.*)$/s);
        if (bracketMatch) {
            speaker = bracketMatch[1].trim();
            textContent = bracketMatch[2].trim();
        } else {
            const colonMatch = textContent.match(/^([A-Za-zА-Яа-яЁё0-9_\s.-]{1,35}):\s+(.*)$/s);
            if (colonMatch) {
                speaker = colonMatch[1].trim();
                textContent = colonMatch[2].trim();
            }
        }

        speaker = speaker ? decodeHtmlEntities(speaker).replace(/^[⌈\uFEFF\u200B\s]+/, '').trim() : null;
        textContent = decodeHtmlEntities(textContent).replace(/^[⌈\uFEFF\u200B\s]+/, '').trim();

        if (!textContent) continue;

        segments.push({
            start,
            end,
            text: textContent,
            speaker: speaker || null
        });
    }

    return segments;
};

export const normalizeJsonTranscript = (parsed) => {
    if (!parsed) return [];

    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (parsed._yjs_state || parsed.comments) {
            return parsed;
        }

        if (Array.isArray(parsed.segments)) {
            const result = [];
            for (const seg of parsed.segments) {
                if (!seg) continue;
                const segSpeaker = seg.speaker ? decodeHtmlEntities(String(seg.speaker)).replace(/^[⌈\uFEFF\u200B\s]+/, '').trim() : null;
                if (Array.isArray(seg.words) && seg.words.length > 0) {
                    for (const w of seg.words) {
                        if (!w) continue;
                        const rawWord = (w.word !== undefined ? w.word : w.text) || '';
                        const wordText = decodeHtmlEntities(String(rawWord)).replace(/^[⌈\uFEFF\u200B\s]+/, '').trim();
                        if (!wordText) continue;
                        const wSpeaker = w.speaker ? decodeHtmlEntities(String(w.speaker)).replace(/^[⌈\uFEFF\u200B\s]+/, '').trim() : null;
                        result.push({
                            start: parseTimestampToSeconds(w.start),
                            end: parseTimestampToSeconds(w.end !== undefined ? w.end : w.start),
                            text: wordText,
                            speaker: wSpeaker || segSpeaker
                        });
                    }
                } else {
                    const rawSegText = seg.text || '';
                    const segText = decodeHtmlEntities(String(rawSegText)).replace(/^[⌈\uFEFF\u200B\s]+/, '').trim();
                    if (segText) {
                        result.push({
                            start: parseTimestampToSeconds(seg.start),
                            end: parseTimestampToSeconds(seg.end !== undefined ? seg.end : seg.start),
                            text: segText,
                            speaker: segSpeaker
                        });
                    }
                }
            }
            return result;
        }

        if (Array.isArray(parsed.chunks)) {
            const result = [];
            for (const chunk of parsed.chunks) {
                if (!chunk) continue;
                let start = 0;
                let end = 0;
                if (Array.isArray(chunk.timestamp)) {
                    start = chunk.timestamp[0];
                    end = (chunk.timestamp[1] !== undefined && chunk.timestamp[1] !== null) ? chunk.timestamp[1] : start;
                } else {
                    start = chunk.start;
                    end = (chunk.end !== undefined && chunk.end !== null) ? chunk.end : start;
                }
                const rawChunkText = chunk.text || '';
                const text = decodeHtmlEntities(String(rawChunkText)).replace(/^[⌈\uFEFF\u200B\s]+/, '').trim();
                const chunkSpeaker = chunk.speaker ? decodeHtmlEntities(String(chunk.speaker)).replace(/^[⌈\uFEFF\u200B\s]+/, '').trim() : null;
                if (text) {
                    result.push({
                        start: parseTimestampToSeconds(start),
                        end: parseTimestampToSeconds(end),
                        text: text,
                        speaker: chunkSpeaker
                    });
                }
            }
            return result;
        }
    }

    if (Array.isArray(parsed)) {
        const result = [];
        for (const line of parsed) {
            if (!line) continue;
            const rawLineText = (line.text !== undefined ? line.text : line.word) || '';
            const text = decodeHtmlEntities(String(rawLineText)).replace(/^[⌈\uFEFF\u200B\s]+/, '').trim();
            const lineSpeaker = line.speaker ? decodeHtmlEntities(String(line.speaker)).replace(/^[⌈\uFEFF\u200B\s]+/, '').trim() : null;
            if (typeof text === 'string' && text.length > 0) {
                result.push({
                    start: parseTimestampToSeconds(line.start),
                    end: parseTimestampToSeconds(line.end !== undefined ? line.end : line.start),
                    text: text,
                    speaker: lineSpeaker
                });
            }
        }
        return result;
    }

    return parsed;
};

export const formatTranscriptToHtml = (segments, pauseThreshold = 1.0) => {
    if (!Array.isArray(segments)) return '';

    const validLines = segments
        .filter(seg => seg && (typeof seg.text === 'string' || typeof seg.word === 'string'))
        .map(seg => {
            const rawText = (seg.text !== undefined ? seg.text : seg.word) || '';
            const start = typeof seg.start === 'number' ? seg.start : parseTimestampToSeconds(seg.start);
            const end = typeof seg.end === 'number' ? seg.end : parseTimestampToSeconds(seg.end !== undefined ? seg.end : seg.start);
            const safeStart = !isNaN(start) ? start : 0;
            const safeEnd = !isNaN(end) ? end : safeStart;
            const unescapedText = decodeHtmlEntities(rawText).replace(/^[⌈\uFEFF\u200B\s]+/, '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
            const cleanText = escapeHtml(unescapedText);
            const cleanSpeaker = seg.speaker ? decodeHtmlEntities(String(seg.speaker)).replace(/^[⌈\uFEFF\u200B\s]+/, '').trim() : null;
            return {
                start: safeStart,
                end: safeEnd,
                cleanText,
                speaker: cleanSpeaker
            };
        })
        .filter(item => item.cleanText.length > 0);

    if (validLines.length === 0) return '';

    validLines.sort((a, b) => a.start - b.start);

    const paragraphs = [];
    let currentParagraphSpans = [];
    let currentParagraphSpeaker = null;
    let prevEnd = null;
    let prevSpeaker = null;

    const flushParagraph = () => {
        if (currentParagraphSpans.length > 0) {
            const speakerPrefix = currentParagraphSpeaker
                ? `<strong>${escapeHtml(currentParagraphSpeaker)}:</strong> `
                : '';
            paragraphs.push(`<p>${speakerPrefix}${currentParagraphSpans.join(' ')}</p>`);
            currentParagraphSpans = [];
            currentParagraphSpeaker = null;
        }
    };

    for (let i = 0; i < validLines.length; i++) {
        const item = validLines[i];
        const { start: safeStart, end: safeEnd, cleanText, speaker } = item;

        if (prevEnd === null) {
            currentParagraphSpeaker = speaker;
            currentParagraphSpans.push(`<span data-start="${safeStart}" data-end="${safeEnd}">${cleanText}</span>`);
            prevEnd = safeEnd;
            prevSpeaker = speaker;
            continue;
        }

        const isOverlap = safeStart < (prevEnd - 0.15);

        if (isOverlap) {
            if (speaker !== prevSpeaker) {
                flushParagraph();
                currentParagraphSpeaker = speaker;
                currentParagraphSpans.push(`<span data-start="${safeStart}" data-end="${safeEnd}">${cleanText}</span>`);
            } else {
                currentParagraphSpans.push(`<span data-start="${safeStart}" data-end="${safeEnd}">${cleanText}</span>`);
            }
        } else {
            const isSpeakerChanged = Boolean(speaker && speaker !== prevSpeaker);
            const isPause = (safeStart - prevEnd) > pauseThreshold;

            if (isSpeakerChanged || isPause) {
                flushParagraph();
                currentParagraphSpeaker = speaker;
                currentParagraphSpans.push(`<span data-start="${safeStart}" data-end="${safeEnd}">${cleanText}</span>`);
            } else {
                currentParagraphSpans.push(`<span data-start="${safeStart}" data-end="${safeEnd}">${cleanText}</span>`);
            }
        }

        prevEnd = Math.max(prevEnd, safeEnd);
        prevSpeaker = speaker;
    }

    flushParagraph();

    return paragraphs.join('');
};

createApp({
    setup() {
        const locale = ref('ru');
        const t = computed(() => (key, params) => {
            let text = dictionary[locale.value]?.[key] || dictionary.ru?.[key] || key;
            if (params && typeof params === 'object') {
                Object.entries(params).forEach(([k, v]) => {
                    text = text.replace(new RegExp(`{${k}}`, 'g'), v);
                });
            }
            return text;
        });
        const toggleLocale = () => { locale.value = locale.value === 'ru' ? 'en' : 'ru'; };

        const sessionMode = ref(null); 
        const isSessionStarted = ref(false);
        const isConnectingP2P = ref(false);
        const connectionState = ref('disconnected'); 
        const syncError = ref(false);
        const connectionErrorMsg = ref('');
        const highlightErrors = ref(false);
        
        const audioUrl = ref('');
        const audioFileName = ref('');
        const jsonFileName = ref('');
        
        const defaultName = 'User ' + Math.floor(Math.random() * 1000);
        const userName = ref(localStorage.getItem('emca_username') || defaultName);
        
        const roomName = ref('');
        const roomPassword = ref('');
        const showRoomPassword = ref(false);
        const isRoomCopied = ref(false);

        const copyRoomDetails = async () => {
            try {
                const pass = roomPassword.value ? roomPassword.value.trim() : '';
                const text = pass 
                    ? `${t.value('room_label')}: ${roomName.value}\n${t.value('password_label')}: ${pass}`
                    : `${t.value('room_label')}: ${roomName.value}`;

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(text);
                } else {
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                }
                isRoomCopied.value = true;
                setTimeout(() => { isRoomCopied.value = false; }, 2000);
            } catch (err) {
                console.error('Failed to copy room details:', err);
            }
        };
        
        const serverPreset = ref('public');
        const customServerUrl = ref('wss://');
        
        const isDraggingAudio = ref(false);
        const isDraggingJson = ref(false);
        const localJsonBuffer = ref(null); 

        // Подсветка текста и комментарии
        const isTextSelected = ref(false);
        const showHighlightPicker = ref(false);
        const highlightColors = [
            { name: 'red', hex: '#dc2626' },
            { name: 'green', hex: '#16a34a' },
            { name: 'blue', hex: '#2563eb' },
            { name: 'purple', hex: '#9333ea' },
            { name: 'pink', hex: '#db2777' },
            { name: 'orange', hex: '#ea580c' },
            { name: 'teal', hex: '#0d9488' }
        ];
        const activeCommentId = ref(null);
        const editingCommentId = ref(null);
        const editingCommentText = ref('');
        const replyInputText = ref({});
        const commentsList = ref([]);
        let yComments = null;
        let yMeta = null;
        let yProposals = null;
        const activeProposal = ref(null);
        const baselineSnapshot = ref(null);
        const proposalFileInput = ref(null);

        const isCommentNew = (commentId) => {
            if (!baselineSnapshot.value || !baselineSnapshot.value.oldCommentIds) return false;
            return !baselineSnapshot.value.oldCommentIds.has(commentId);
        };

        const isReplyNew = (replyId) => {
            if (!baselineSnapshot.value || !baselineSnapshot.value.oldReplyIds) return false;
            return !baselineSnapshot.value.oldReplyIds.has(replyId);
        };

        let ydoc = null;
        let provider = null;
        let idbProvider = null;
        const connectedPeers = ref(1);
        const peersList = ref([]);
        const showPeersList = ref(false);

        const currentTime = ref(0);
        const isPlaying = ref(false);
        const isAudioReady = ref(false);
        const zoomLevel = ref(10);
        const zoomStep = 25;
        
        const freqMinInput = ref(0);
        const freqMaxInput = ref(500);
        const freqMin = ref(0);
        const freqMax = ref(500);

        const waveformRef = ref(null);
        const editorRef = ref(null);
        const autoScroll = ref(true);
        const currentAlignment = ref('left');
        const highlightActiveSegment = ref(localStorage.getItem('emca_highlight_segment') === 'true');
        const seekOnClick = ref(localStorage.getItem('emca_seek_on_click') !== 'false');
        watch(seekOnClick, (val) => localStorage.setItem('emca_seek_on_click', val));
        
        let ws = null;
        let activeSpectrogramPlugin = null;
        let regionsPlugin = null;
        let activeLoopRegion = null;
        let disableDragSelectionFn = null;
        let zoomRedrawTimer = null;
        let editor = null;
        let currentActiveSegmentRange = null;

        const clearSegmentHighlight = () => {
            if (editorRef.value) {
                const highlighted = editorRef.value.querySelectorAll('.active-segment-highlight');
                highlighted.forEach(el => el.classList.remove('active-segment-highlight'));
            }
            currentActiveSegmentRange = null;
        };

        const updateActiveSegmentHighlight = (time) => {
            if (!highlightActiveSegment.value) {
                if (currentActiveSegmentRange !== null) {
                    clearSegmentHighlight();
                }
                return;
            }

            if (!editorRef.value) return;

            // Быстрая проверка: если время внутри текущего диапазона и класс на месте
            if (currentActiveSegmentRange) {
                if (time >= currentActiveSegmentRange.start && time <= currentActiveSegmentRange.end) {
                    const activeElements = editorRef.value.querySelectorAll('.active-segment-highlight');
                    if (activeElements.length > 0) {
                        return;
                    }
                }
            }

            const allSpans = editorRef.value.querySelectorAll('[data-start]');
            if (!allSpans || allSpans.length === 0) {
                clearSegmentHighlight();
                return;
            }

            let targetStart = null;
            let targetEnd = null;
            let firstMatchingEl = null;

            for (let i = 0; i < allSpans.length; i++) {
                const el = allSpans[i];
                const s = parseFloat(el.getAttribute('data-start'));
                const e = parseFloat(el.getAttribute('data-end'));
                if (isNaN(s)) continue;
                const safeEnd = !isNaN(e) ? e : s;

                if (time >= s && time <= safeEnd) {
                    targetStart = s;
                    targetEnd = safeEnd;
                    firstMatchingEl = el;
                    break;
                }
            }

            if (firstMatchingEl === null) {
                clearSegmentHighlight();
                return;
            }

            // Снимаем подсветку со старых элементов
            const oldHighlighted = editorRef.value.querySelectorAll('.active-segment-highlight');
            oldHighlighted.forEach(el => el.classList.remove('active-segment-highlight'));

            // Добавляем подсветку всем элементам данного интервала
            for (let i = 0; i < allSpans.length; i++) {
                const el = allSpans[i];
                const s = parseFloat(el.getAttribute('data-start'));
                const e = parseFloat(el.getAttribute('data-end'));
                const safeEnd = !isNaN(e) ? e : s;
                if (s === targetStart && safeEnd === targetEnd) {
                    el.classList.add('active-segment-highlight');
                }
            }

            currentActiveSegmentRange = { start: targetStart, end: targetEnd };

            // Плавный скролл к элементу при необходимости
            if (firstMatchingEl) {
                const container = editorRef.value.closest('.overflow-y-auto');
                if (container) {
                    const elRect = firstMatchingEl.getBoundingClientRect();
                    const cRect = container.getBoundingClientRect();
                    if (elRect.top < cRect.top || elRect.bottom > cRect.bottom) {
                        firstMatchingEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                }
            }
        };

        watch(highlightActiveSegment, (newVal) => {
            localStorage.setItem('emca_highlight_segment', newVal);
            if (newVal) {
                updateActiveSegmentHighlight(currentTime.value);
            } else {
                clearSegmentHighlight();
            }
        });

        const isDraggingWave = ref(false);
        let pointerStartX = 0;
        let initialScrollLeft = 0;
        let wasDragged = false;
        const isLoopMode = ref(false);
        const hasActiveLoop = ref(false);
        let loopTimeout = null;

        const activeSignalingServer = computed(() => {
            return serverPreset.value === 'public' ? 'wss://signaling.yjs.dev' : customServerUrl.value.trim();
        });

        watch(userName, (newVal) => {
            localStorage.setItem('emca_username', newVal);
        });

        const setMode = (mode) => { sessionMode.value = mode; highlightErrors.value = false; connectionErrorMsg.value = ''; };

        const isReadyToStart = computed(() => {
            if (!userName.value.trim()) return false;
            if (sessionMode.value !== 'local') {
                if (serverPreset.value === 'custom') {
                    const url = customServerUrl.value.trim();
                    if (!url.startsWith('ws://') && !url.startsWith('wss://')) return false;
                    if (url.length <= 6) return false;
                }
            }
            if (sessionMode.value === 'local') return audioUrl.value !== '' && localJsonBuffer.value !== null;
            if (sessionMode.value === 'host') return audioUrl.value !== '' && localJsonBuffer.value !== null && roomName.value.trim() !== '';
            if (sessionMode.value === 'join') return audioUrl.value !== '' && roomName.value.trim() !== '';
            return false;
        });

        const freqLabels = computed(() => {
            const min = freqMin.value;
            const max = freqMax.value;
            const step = (max - min) / 4;
            const labels = [];
            for (let i = 4; i >= 0; i--) {
                const val = Math.round(min + step * i);
                labels.push(val >= 1000 ? (val / 1000).toFixed(1) + ' kHz' : val + ' Hz');
            }
            return labels;
        });

        const processAudioFile = (file) => {
            if (file) {
                audioUrl.value = URL.createObjectURL(file);
                audioFileName.value = file.name;
            }
        };
        const handleStartAudio = (event) => processAudioFile(event.target.files[0]);
        const handleAudioDrop = (event) => {
            isDraggingAudio.value = false;
            const file = event.dataTransfer.files[0];
            if (file) processAudioFile(file);
        };

        const processJsonFile = (file) => {
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const rawContent = (e.target.result || '').replace(/^\uFEFF/, '');
                        const nameLower = file.name.toLowerCase();
                        let result;

                        if (nameLower.endsWith('.vtt')) {
                            result = parseVttToSegments(rawContent);
                        } else if (nameLower.endsWith('.srt')) {
                            result = parseSrtToSegments(rawContent);
                        } else {
                            const parsed = JSON.parse(rawContent);
                            result = normalizeJsonTranscript(parsed);
                        }

                        jsonFileName.value = file.name;
                        if (isSessionStarted.value && ydoc) {
                            loadInitialTranscript(result);
                        } else {
                            localJsonBuffer.value = result;
                        }
                    } catch (err) {
                        console.error("Error reading transcript file:", err);
                        alert("Error reading transcript file.");
                    }
                };
                reader.readAsText(file);
            }
        };
        const handleStartJson = (event) => processJsonFile(event.target.files[0]);
        const handleJsonDrop = (event) => {
            isDraggingJson.value = false;
            const file = event.dataTransfer.files[0];
            if (file) {
                const nameLower = file.name.toLowerCase();
                if (nameLower.endsWith('.json') || nameLower.endsWith('.vtt') || nameLower.endsWith('.srt')) {
                    processJsonFile(file);
                } else {
                    alert("Please drop a .json, .vtt, or .srt format file.");
                }
            }
        };

        const updatePeersList = () => {
            if (!provider) return;
            const states = provider.awareness.getStates();
            connectedPeers.value = states.size;
            
            const arr = [];
            states.forEach((state, clientId) => {
                arr.push({
                    id: clientId,
                    name: state.user?.name || 'Anonymous',
                    isMe: clientId === ydoc.clientID
                });
            });
            
            arr.sort((a, b) => {
                if (a.isMe) return -1;
                if (b.isMe) return 1;
                return a.name.localeCompare(b.name);
            });
            peersList.value = arr;

            if (connectedPeers.value > 1) {
                connectionState.value = 'connected';
                syncError.value = false; 
            } else {
                connectionState.value = 'waiting';
            }
        };
        
        const checkServerConnection = (url) => {
            return new Promise((resolve, reject) => {
                let settled = false;
                const fail = (reason) => {
                    if (!settled) {
                        settled = true;
                        reject(new Error(reason));
                    }
                };

                try {
                    const testWs = new WebSocket(url);
                    const timeout = setTimeout(() => {
                        try { testWs.close(); } catch (e) {}
                        fail("Таймаут соединения. Сервер не ответил за 5 секунд.");
                    }, 5000);

                    testWs.onopen = () => {
                        if (!settled) {
                            settled = true;
                            clearTimeout(timeout);
                            testWs.close();
                            resolve();
                        }
                    };
                    testWs.onerror = () => {
                        clearTimeout(timeout);
                        fail("Сервер отклонил соединение. Проверьте правильность адреса.");
                    };
                    testWs.onclose = () => {
                        clearTimeout(timeout);
                        fail("Соединение разорвано на этапе рукопожатия.");
                    };
                } catch (err) {
                    fail("Не удалось создать WebSocket (ошибка синтаксиса URL).");
                }
            });
        };

        const TimecodeMark = Mark.create({
            name: 'timecode',
            inclusive: false,
            addAttributes() {
                return {
                    start: {
                        default: null,
                        parseHTML: element => element.getAttribute('data-start'),
                        renderHTML: attributes => ({ 'data-start': attributes.start }),
                    },
                    end: {
                        default: null,
                        parseHTML: element => element.getAttribute('data-end'),
                        renderHTML: attributes => ({ 'data-end': attributes.end }),
                    }
                }
            },
            parseHTML() { return [{ tag: 'span[data-start]' }] },
            renderHTML({ HTMLAttributes }) {
                return ['span', mergeAttributes(HTMLAttributes, { 
                    class: 'timecode-segment hover:bg-gray-100 cursor-pointer transition-colors duration-150 rounded px-0.5' 
                }), 0]
            },
        });

        const CommentMark = Mark.create({
            name: 'comment',
            inclusive: false,
            excludes: '',
            addAttributes() {
                return {
                    commentId: {
                        default: null,
                        parseHTML: element => element.getAttribute('data-comment-id'),
                        renderHTML: attributes => {
                            if (!attributes.commentId) return {};
                            return {
                                'data-comment-id': attributes.commentId,
                                class: 'emca-comment-mark'
                            };
                        }
                    }
                };
            },
            parseHTML() {
                return [{ tag: 'span[data-comment-id]' }];
            },
            renderHTML({ HTMLAttributes }) {
                return ['span', mergeAttributes(HTMLAttributes), 0];
            }
        });

        const TextColorMark = Mark.create({
            name: 'textColor',
            inclusive: false,
            addAttributes() {
                return {
                    color: {
                        default: null,
                        parseHTML: element => element.getAttribute('data-text-color') || element.style.color,
                        renderHTML: attributes => {
                            if (!attributes.color) return {};
                            return {
                                'data-text-color': attributes.color,
                                style: `color: ${attributes.color}; font-weight: 500;`
                            };
                        }
                    }
                };
            },
            parseHTML() { return [{ tag: 'span[data-text-color]' }]; },
            renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes), 0]; }
        });

        const uint8ArrayToBase64 = (bytes) => {
            let binary = '';
            const len = bytes.byteLength;
            for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return window.btoa(binary);
        };

        const base64ToUint8Array = (base64) => {
            const binary = window.atob(base64);
            const len = binary.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        };

        const updateCommentsFromYjs = () => {
            if (!yComments) {
                commentsList.value = [];
                return;
            }
            const list = [];
            yComments.forEach((val, key) => {
                if (val) {
                    list.push({ ...val, id: key });
                }
            });
            list.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
            commentsList.value = list;
        };

        const initRichTextEditor = () => {
            const extensions = [
                StarterKit.configure({
                    history: false,
                }),
                TimecodeMark,
                CommentMark,
                TextColorMark,
                TextAlign.configure({
                    types: ['heading', 'paragraph'],
                    alignments: ['left', 'justify'],
                    defaultAlignment: 'left',
                }),
                Collaboration.configure({ document: ydoc, field: 'emca-transcript' })
            ];

            if (sessionMode.value !== 'local' && provider) {
                const coloredSwatches = colorSwatches.filter(s => s.hex && s.key);
                const randomColor = coloredSwatches.length > 0
                    ? coloredSwatches[Math.floor(Math.random() * coloredSwatches.length)].hex
                    : (colorSwatches[0]?.hex || '#0ea5e9');

                extensions.push(CollaborationCursor.configure({
                    provider: provider,
                    user: {
                        name: userName.value,
                        color: randomColor
                    }
                }));
            }

            editor = new Editor({
                element: editorRef.value,
                extensions: extensions,
                editorProps: {
                    attributes: {
                        class: 'prose max-w-none focus:outline-none min-h-[500px] leading-relaxed p-4',
                        spellcheck: 'false',
                    },
                },
            });

            const checkSelection = () => {
                if (!editor) {
                    isTextSelected.value = false;
                    return;
                }
                const { from, to, empty } = editor.state.selection;
                isTextSelected.value = !empty && (to - from > 0);
            };

            editor.on('selectionUpdate', () => {
                currentAlignment.value = editor.isActive({ textAlign: 'justify' }) ? 'justify' : 'left';
                checkSelection();
            });
            editor.on('transaction', () => {
                currentAlignment.value = editor.isActive({ textAlign: 'justify' }) ? 'justify' : 'left';
                checkSelection();
                if (highlightActiveSegment.value) {
                    updateActiveSegmentHighlight(currentTime.value);
                }
            });

            editor.view.dom.addEventListener('click', (e) => {
                const timecodeSpan = e.target.closest('[data-start]');
                if (timecodeSpan) {
                    const startTime = parseFloat(timecodeSpan.getAttribute('data-start'));
                    if (!isNaN(startTime) && seekOnClick.value && editor.state.selection.empty) {
                        jumpTo(startTime);
                    }
                }

                const commentSpan = e.target.closest('[data-comment-id]');
                if (commentSpan) {
                    const cId = commentSpan.getAttribute('data-comment-id');
                    if (cId) {
                        selectComment(cId);
                    }
                }
            });
        };

        const mergeCommentsData = (yCommentsMap, incomingCommentsArray) => {
            if (!yCommentsMap || !Array.isArray(incomingCommentsArray)) return;

            incomingCommentsArray.forEach(incoming => {
                if (!incoming || !incoming.id) return;
                const existing = yCommentsMap.get(incoming.id);

                if (!existing) {
                    yCommentsMap.set(incoming.id, incoming);
                } else {
                    const existingReplies = Array.isArray(existing.replies) ? existing.replies : [];
                    const incomingReplies = Array.isArray(incoming.replies) ? incoming.replies : [];

                    const repliesMap = new Map();
                    existingReplies.forEach(r => {
                        if (r && r.id) repliesMap.set(r.id, r);
                    });
                    incomingReplies.forEach(r => {
                        if (!r || !r.id) return;
                        if (!repliesMap.has(r.id)) {
                            repliesMap.set(r.id, r);
                        } else {
                            const prev = repliesMap.get(r.id);
                            const prevTime = new Date(prev.updatedAt || prev.createdAt || 0).getTime();
                            const currTime = new Date(r.updatedAt || r.createdAt || 0).getTime();
                            if (currTime >= prevTime) {
                                repliesMap.set(r.id, { ...prev, ...r });
                            }
                        }
                    });

                    const mergedReplies = Array.from(repliesMap.values()).sort(
                        (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
                    );

                    const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
                    const incomingTime = new Date(incoming.updatedAt || incoming.createdAt || 0).getTime();
                    const useIncoming = incomingTime >= existingTime;

                    const mergedComment = {
                        ...existing,
                        ...incoming,
                        text: useIncoming ? (incoming.text !== undefined ? incoming.text : existing.text) : existing.text,
                        updatedAt: useIncoming ? (incoming.updatedAt || existing.updatedAt) : existing.updatedAt,
                        replies: mergedReplies
                    };

                    yCommentsMap.set(incoming.id, mergedComment);
                }
            });
        };

        const loadInitialTranscript = async (jsonBuffer) => {
            if (!editor || !ydoc) return;
            if (yMeta && !yMeta.get('transcriptId')) {
                const tid = (jsonBuffer && typeof jsonBuffer === 'object' && !Array.isArray(jsonBuffer) && jsonBuffer.transcriptId)
                    ? jsonBuffer.transcriptId
                    : ('tr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));
                yMeta.set('transcriptId', tid);
            }
            if (jsonBuffer && typeof jsonBuffer === 'object' && !Array.isArray(jsonBuffer)) {
                if (jsonBuffer._yjs_state) {
                    try {
                        const yjsModule = await import('https://esm.sh/yjs@13.6.18');
                        const Y = yjsModule.default || yjsModule;
                        const update = base64ToUint8Array(jsonBuffer._yjs_state);
                        Y.applyUpdate(ydoc, update);
                    } catch (e) {
                        console.error('Error applying CRDT update:', e);
                    }
                } else if (jsonBuffer.comments && yComments) {
                    mergeCommentsData(yComments, jsonBuffer.comments);
                    if (jsonBuffer.content) {
                        editor.commands.setContent(jsonBuffer.content);
                    }
                } else {
                    const normalized = normalizeJsonTranscript(jsonBuffer);
                    if (Array.isArray(normalized)) {
                        const htmlContent = formatTranscriptToHtml(normalized, 1.0);
                        editor.commands.setContent(htmlContent);
                    }
                }
            } else if (Array.isArray(jsonBuffer)) {
                const htmlContent = formatTranscriptToHtml(jsonBuffer, 1.0);
                editor.commands.setContent(htmlContent);
            }
            nextTick(() => {
                if (highlightActiveSegment.value) {
                    updateActiveSegmentHighlight(currentTime.value);
                }
            });
        };

        const startSession = async () => {
            highlightErrors.value = true;
            if (!isReadyToStart.value) return;
            connectionErrorMsg.value = '';

            try {
                if (sessionMode.value !== 'local') {
                    isConnectingP2P.value = true;
                    await checkServerConnection(activeSignalingServer.value);
                }

                if (idbProvider) {
                    try { idbProvider.destroy(); } catch (e) {}
                    idbProvider = null;
                }
                if (provider) {
                    try { provider.destroy(); } catch (e) {}
                    provider = null;
                }
                if (ydoc) {
                    try { ydoc.destroy(); } catch (e) {}
                    ydoc = null;
                }

                const yjsModule = await import('https://esm.sh/yjs@13.6.18');
                const Y = yjsModule.default || yjsModule;
                ydoc = new Y.Doc();

                const dbKey = 'emca-session-' + (sessionMode.value === 'local' ? audioFileName.value : roomName.value);
                idbProvider = new IndexeddbPersistence(dbKey, ydoc);

                let awareness = null;
                if (sessionMode.value !== 'local') {
                    const awarenessModule = await import('https://esm.sh/y-protocols@1.0.6/awareness?deps=yjs@13.6.18');
                    awareness = new awarenessModule.Awareness(ydoc);
                    provider = { awareness };
                }

                let isSyncedHandled = false;
                const handleSynced = async () => {
                    if (isSyncedHandled) return;
                    isSyncedHandled = true;

                    try {
                        // 1. Инициализируем карты yComments, yMeta, yProposals (с их observe)
                        yComments = ydoc.getMap('emca-comments');
                        yMeta = ydoc.getMap('emca-meta');
                        yProposals = ydoc.getMap('emca-proposals');

                        baselineSnapshot.value = null;
                        activeProposal.value = null;

                        yComments.observeDeep(() => {
                            updateCommentsFromYjs();
                        });
                        updateCommentsFromYjs();

                        yProposals.observe(() => {
                            const act = yProposals.get('active');
                            activeProposal.value = act || null;
                            if (!act && baselineSnapshot.value) {
                                baselineSnapshot.value = null;
                            }
                        });
                        activeProposal.value = yProposals.get('active') || null;

                        // 2. Вызываем initPlayer() и initRichTextEditor()
                        isSessionStarted.value = true;
                        await nextTick();
                        initPlayer();
                        initRichTextEditor();

                        // 3. Если есть localJsonBuffer - вызываем loadInitialTranscript(localJsonBuffer.value) и очищаем буфер
                        if (localJsonBuffer.value) {
                            const hasExistingData = ydoc.getXmlFragment('emca-transcript').length > 0;
                            if (!hasExistingData) {
                                await loadInitialTranscript(localJsonBuffer.value);
                            }
                            localJsonBuffer.value = null;
                        }

                        // 4. Если sessionMode !== 'local', только теперь подключаем WebrtcProvider!
                        if (sessionMode.value !== 'local') {
                            const webrtcModule = await import('https://esm.sh/y-webrtc@10.3.0?deps=yjs@13.6.18');
                            const WebrtcProvider = webrtcModule.WebrtcProvider;

                            const providerOpts = { 
                                signaling: [activeSignalingServer.value],
                                peerOpts: { config: { iceServers: [ { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' } ] } },
                                awareness: awareness
                            };
                            if (roomPassword.value.trim() !== '') providerOpts.password = roomPassword.value.trim();

                            const webrtc = new WebrtcProvider('emca-p2p-' + roomName.value.trim(), ydoc, providerOpts);
                            webrtc.awareness.setLocalStateField('user', { name: userName.value.trim() || 'User ' + Math.floor(Math.random() * 1000) });
                            webrtc.awareness.on('change', updatePeersList);
                            provider = webrtc;
                            updatePeersList();

                            isConnectingP2P.value = false;
                            connectionState.value = 'waiting';
                        }
                    } catch (err) {
                        isConnectingP2P.value = false;
                        connectionErrorMsg.value = err.message;
                        console.error('Session initialization error:', err);
                    }
                };

                idbProvider.on('synced', handleSynced);
                if (idbProvider.synced) {
                    handleSynced();
                }
            } catch (e) {
                isConnectingP2P.value = false;
                connectionErrorMsg.value = e.message;
            }
        };

        const toggleHighlightPicker = () => {
            if (isTextSelected.value) {
                showHighlightPicker.value = !showHighlightPicker.value;
            }
        };

        const applyHighlight = (colorHex) => {
            if (editor) editor.chain().focus().setMark('textColor', { color: colorHex }).run();
            showHighlightPicker.value = false;
        };

        const clearHighlight = () => {
            if (editor) editor.chain().focus().unsetMark('textColor').run();
            showHighlightPicker.value = false;
        };

        const formatCommentTime = (isoString) => {
            if (!isoString) return '';
            try {
                const d = new Date(isoString);
                return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString([], { day: 'numeric', month: 'short' });
            } catch {
                return '';
            }
        };

        const addCommentAtSelection = () => {
            if (!editor || !isTextSelected.value) return;
            const { from, to, empty } = editor.state.selection;
            if (empty || from >= to) return;

            const quote = editor.state.doc.textBetween(from, to, ' ').trim().slice(0, 150);
            const commentId = 'c_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

            editor.chain().focus().setMark('comment', { commentId }).run();

            const newComment = {
                id: commentId,
                author: userName.value.trim() || 'Anonymous',
                text: '',
                quote: quote,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                replies: []
            };

            if (yComments) {
                yComments.set(commentId, newComment);
            }

            activeCommentId.value = commentId;
            editingCommentId.value = commentId;
            editingCommentText.value = '';

            nextTick(() => {
                const card = document.getElementById('comment-card-' + commentId);
                if (card) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    const textarea = card.querySelector('textarea');
                    if (textarea) textarea.focus();
                }
            });
        };

        const selectComment = (commentId) => {
            activeCommentId.value = commentId;
            nextTick(() => {
                const card = document.getElementById('comment-card-' + commentId);
                if (card) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
        };

        const jumpToCommentInEditor = (commentId) => {
            activeCommentId.value = commentId;
            if (!editorRef.value) return;
            const markEl = editorRef.value.querySelector(`[data-comment-id="${commentId}"]`);
            if (markEl) {
                markEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                markEl.classList.add('emca-comment-pulse');
                setTimeout(() => {
                    markEl.classList.remove('emca-comment-pulse');
                }, 1800);
            }
        };

        const startEditComment = (comment) => {
            editingCommentId.value = comment.id;
            editingCommentText.value = comment.text || '';
            nextTick(() => {
                const card = document.getElementById('comment-card-' + comment.id);
                if (card) {
                    const textarea = card.querySelector('textarea');
                    if (textarea) textarea.focus();
                }
            });
        };

        const saveCommentEdit = (commentId) => {
            if (!yComments) return;
            const existing = yComments.get(commentId);
            if (!existing) return;

            const trimmed = editingCommentText.value.trim();
            if (!trimmed && (!existing.replies || existing.replies.length === 0)) {
                deleteComment(commentId);
                return;
            }

            yComments.set(commentId, {
                ...existing,
                text: trimmed,
                updatedAt: new Date().toISOString()
            });
            editingCommentId.value = null;
            editingCommentText.value = '';
        };

        const cancelCommentEdit = (commentId) => {
            const existing = yComments ? yComments.get(commentId) : null;
            if (existing && (!existing.text || existing.text.trim() === '') && (!existing.replies || existing.replies.length === 0)) {
                deleteComment(commentId);
            }
            editingCommentId.value = null;
            editingCommentText.value = '';
        };

        const deleteComment = (commentId) => {
            if (editor) {
                editor.commands.command(({ tr, dispatch }) => {
                    if (dispatch) {
                        tr.doc.descendants((node, pos) => {
                            if (!node.marks || node.marks.length === 0) return;
                            node.marks.forEach(mark => {
                                if (mark.type.name === 'comment' && mark.attrs.commentId === commentId) {
                                    tr.removeMark(pos, pos + node.nodeSize, mark);
                                }
                            });
                        });
                    }
                    return true;
                });
            }

            if (yComments) {
                yComments.delete(commentId);
            }

            if (activeCommentId.value === commentId) activeCommentId.value = null;
            if (editingCommentId.value === commentId) {
                editingCommentId.value = null;
                editingCommentText.value = '';
            }
        };

        const addReply = (commentId) => {
            const text = (replyInputText.value[commentId] || '').trim();
            if (!text || !yComments) return;

            const existing = yComments.get(commentId);
            if (!existing) return;

            const replies = Array.isArray(existing.replies) ? [...existing.replies] : [];
            replies.push({
                id: 'r_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
                author: userName.value.trim() || 'Anonymous',
                text: text,
                createdAt: new Date().toISOString()
            });

            yComments.set(commentId, {
                ...existing,
                replies: replies,
                updatedAt: new Date().toISOString()
            });

            replyInputText.value[commentId] = '';
        };

        const deleteReply = (commentId, replyId) => {
            if (!yComments) return;
            const existing = yComments.get(commentId);
            if (!existing || !Array.isArray(existing.replies)) return;

            const replies = existing.replies.filter(r => r.id !== replyId);
            yComments.set(commentId, {
                ...existing,
                replies: replies,
                updatedAt: new Date().toISOString()
            });
        };

        const exportJson = async () => {
            if (!ydoc) return;
            try {
                const yjsModule = await import('https://esm.sh/yjs@13.6.18');
                const Y = yjsModule.default || yjsModule;
                const stateUpdate = Y.encodeStateAsUpdate(ydoc);
                const base64State = uint8ArrayToBase64(stateUpdate);

                const payload = {
                    version: '2.0',
                    transcriptId: yMeta ? yMeta.get('transcriptId') : undefined,
                    exportedAt: new Date().toISOString(),
                    audioFileName: audioFileName.value || '',
                    comments: commentsList.value,
                    _yjs_state: base64State
                };

                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const baseName = (audioFileName.value || 'session').replace(/\.[^/.]+$/, '');
                a.href = url;
                a.download = `${baseName}_annotated.json`;
                a.click();
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error('Export error:', err);
            }
        };

        const handleProposalFileChange = (event) => {
            const file = event.target?.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const parsed = JSON.parse(e.target.result);
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed._yjs_state) {
                        alert(t.value('error_v2_required'));
                        event.target.value = '';
                        return;
                    }

                    const currentTranscriptId = yMeta ? yMeta.get('transcriptId') : null;
                    const fileTranscriptId = parsed.transcriptId;
                    if (!currentTranscriptId || !fileTranscriptId || currentTranscriptId !== fileTranscriptId) {
                        alert(t.value('error_different_baseline'));
                        event.target.value = '';
                        return;
                    }

                    const proposal = {
                        id: 'prop_' + Date.now(),
                        author: userName.value.trim() || 'Guest',
                        fileName: file.name,
                        yjsState: parsed._yjs_state,
                        comments: parsed.comments || [],
                        createdAt: new Date().toISOString(),
                        status: 'pending'
                    };

                    if (yProposals) {
                        yProposals.set('active', proposal);
                        alert(t.value('proposal_sent_notice'));
                    }
                } catch (err) {
                    console.error('Failed to parse proposal json:', err);
                    alert(t.value('error_v2_required'));
                } finally {
                    event.target.value = '';
                }
            };
            reader.readAsText(file);
        };

        const previewProposal = async () => {
            if (!editor || !ydoc || !yProposals) return;
            const proposal = yProposals.get('active');
            if (!proposal || !proposal.yjsState) return;

            baselineSnapshot.value = {
                editorJson: editor.getJSON(),
                comments: JSON.parse(JSON.stringify(commentsList.value)),
                oldCommentIds: new Set(commentsList.value.map(c => c.id)),
                oldReplyIds: new Set(commentsList.value.flatMap(c => (c.replies || []).map(r => r.id)))
            };

            yProposals.set('active', {
                ...proposal,
                status: 'previewing'
            });

            try {
                const yjsModule = await import('https://esm.sh/yjs@13.6.18');
                const Y = yjsModule.default || yjsModule;
                const update = base64ToUint8Array(proposal.yjsState);
                Y.applyUpdate(ydoc, update);

                if (yComments && proposal.comments && Array.isArray(proposal.comments)) {
                    mergeCommentsData(yComments, proposal.comments);
                }
            } catch (err) {
                console.error('Failed to apply preview update:', err);
            }
        };

        const acceptProposal = () => {
            baselineSnapshot.value = null;
            if (yProposals) {
                yProposals.delete('active');
            }
        };

        const rejectProposal = () => {
            if (baselineSnapshot.value) {
                if (editor && baselineSnapshot.value.editorJson) {
                    editor.commands.setContent(baselineSnapshot.value.editorJson);
                }
                if (yComments && ydoc) {
                    ydoc.transact(() => {
                        const currentKeys = Array.from(yComments.keys());
                        for (const key of currentKeys) {
                            yComments.delete(key);
                        }
                        if (Array.isArray(baselineSnapshot.value.comments)) {
                            baselineSnapshot.value.comments.forEach(comment => {
                                yComments.set(comment.id, comment);
                            });
                        }
                    });
                    updateCommentsFromYjs();
                }
                baselineSnapshot.value = null;
            }
            if (yProposals) {
                yProposals.delete('active');
            }
        };

        const setAlignment = (align) => {
            if (!editor) return;
            const { from, to } = editor.state.selection;
            if (from === to) {
                editor.chain().focus().selectAll().setTextAlign(align).setTextSelection(from).run();
            } else {
                editor.chain().focus().setTextAlign(align).run();
            }
            currentAlignment.value = align;
        };

        const initSpectrogram = () => {
            if (!ws) return;
            if (activeSpectrogramPlugin) {
                try { activeSpectrogramPlugin.destroy(); } catch (e) {}
            }
            activeSpectrogramPlugin = Spectrogram.create({
                labels: false, height: 120, splitChannels: false,
                frequencyMin: freqMin.value, frequencyMax: freqMax.value, fftSamples: 2048
            });
            ws.registerPlugin(activeSpectrogramPlugin);
        };

        const applyFrequencyRange = () => {
            let min = Number(freqMinInput.value);
            let max = Number(freqMaxInput.value);
            if (isNaN(min) || min < 0) min = 0;
            if (isNaN(max) || max <= min) max = min + 100;
            freqMinInput.value = min;
            freqMaxInput.value = max;
            freqMin.value = min;
            freqMax.value = max;
            initSpectrogram();
        };

        const getScrollContainer = () => {
            if (!ws) return null;
            const wrapper = ws.getWrapper();
            return wrapper ? wrapper.parentElement : null;
        };

        const initPlayer = () => {
            regionsPlugin = RegionsPlugin.create();
            ws = WaveSurfer.create({
                container: waveformRef.value, waveColor: '#60a5fa', progressColor: '#2563eb', cursorColor: '#ef4444',
                cursorWidth: 2, height: 80, interact: false, autoCenter: autoScroll.value, url: audioUrl.value, plugins: [regionsPlugin]
            });

            initSpectrogram();
            ws.on('ready', () => { isAudioReady.value = true; });
            ws.on('play', () => { isPlaying.value = true; });
            ws.on('pause', () => { isPlaying.value = false; });
            ws.on('timeupdate', (time) => { currentTime.value = time; });
            ws.on('seeking', (time) => {
                currentTime.value = time;
                if (highlightActiveSegment.value) {
                    updateActiveSegmentHighlight(time);
                }
            });

            regionsPlugin.on('region-created', (region) => {
                if (activeLoopRegion && activeLoopRegion !== region) activeLoopRegion.remove();
                activeLoopRegion = region;
                hasActiveLoop.value = true;
            });
            regionsPlugin.on('region-updated', () => { clearTimeout(loopTimeout); });
        };

        const onWaveWheel = (e) => {
            if (!ws || !isAudioReady.value) return;
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                if (e.deltaY > 0) zoomOut(); else zoomIn();
            } else {
                const sc = getScrollContainer();
                if (sc) {
                    sc.scrollLeft += (e.deltaX !== 0 ? e.deltaX : e.deltaY);
                    e.preventDefault();
                }
            }
        };

        const onWavePointerDown = (e) => {
            if (!ws || !isAudioReady.value || isLoopMode.value) return;
            isDraggingWave.value = true;
            wasDragged = false;
            pointerStartX = e.clientX;
            const sc = getScrollContainer();
            initialScrollLeft = sc ? sc.scrollLeft : 0;
            e.currentTarget.setPointerCapture(e.pointerId);
        };

        const onWavePointerMove = (e) => {
            if (!isDraggingWave.value || isLoopMode.value || !ws) return;
            const dx = e.clientX - pointerStartX;
            if (Math.abs(dx) > 5) wasDragged = true;
            if (wasDragged) {
                const sc = getScrollContainer();
                if (sc) sc.scrollLeft = initialScrollLeft - dx;
            }
        };

        const onWavePointerUp = (e) => {
            if (!isDraggingWave.value) return;
            isDraggingWave.value = false;
            e.currentTarget.releasePointerCapture(e.pointerId);

            if (!wasDragged && !isLoopMode.value && ws) {
                const sc = getScrollContainer();
                const wrapper = ws.getWrapper();
                if (sc && wrapper) {
                    const rect = sc.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const trueX = sc.scrollLeft + clickX;
                    const totalWidth = wrapper.offsetWidth;
                    if (totalWidth > 0) {
                        const targetRatio = Math.max(0, Math.min(1, trueX / totalWidth));
                        const newTime = targetRatio * ws.getDuration();
                        ws.setTime(newTime);
                        currentTime.value = newTime;
                        if (highlightActiveSegment.value) {
                            updateActiveSegmentHighlight(newTime);
                        }
                    }
                }
            }
            wasDragged = false;
        };

        onUnmounted(() => { 
            clearTimeout(loopTimeout);
            clearTimeout(zoomRedrawTimer);
            if (editor) editor.destroy();
            if (ws) ws.destroy(); 
            if (provider) provider.destroy();
            if (idbProvider) idbProvider.destroy();
            if (ydoc) ydoc.destroy();
            if (audioUrl.value) URL.revokeObjectURL(audioUrl.value);
        });

        const togglePlay = () => { 
            if (!ws) return;
            if (isPlaying.value) {
                ws.pause();
                clearTimeout(loopTimeout);
            } else {
                if (isLoopMode.value && activeLoopRegion) {
                    if (currentTime.value < activeLoopRegion.start || currentTime.value >= activeLoopRegion.end) {
                        ws.setTime(activeLoopRegion.start);
                    }
                }
                ws.play();
            }
        };
        
        const zoomIn = () => { zoomLevel.value = Math.min(500, Number(zoomLevel.value) + zoomStep); onZoom(); };
        const zoomOut = () => { zoomLevel.value = Math.max(10, Number(zoomLevel.value) - zoomStep); onZoom(); };

        const onZoom = () => { 
            if (!ws) return;
            ws.zoom(Number(zoomLevel.value));
            clearTimeout(zoomRedrawTimer);
            zoomRedrawTimer = setTimeout(() => { initSpectrogram(); }, 300);
        };

        const jumpTo = (time) => {
            if (ws) {
                ws.setTime(time);
                currentTime.value = time;
                if (highlightActiveSegment.value) {
                    updateActiveSegmentHighlight(time);
                }
                if (!isPlaying.value) ws.play();
            }
        };

        const toggleLoopMode = () => {
            isLoopMode.value = !isLoopMode.value;
            clearTimeout(loopTimeout);

            if (isLoopMode.value) {
                if (ws && isPlaying.value) ws.pause();
                if (regionsPlugin) disableDragSelectionFn = regionsPlugin.enableDragSelection({ color: 'rgba(147, 51, 234, 0.35)' });
            } else {
                if (disableDragSelectionFn) { disableDragSelectionFn(); disableDragSelectionFn = null; }
                if (regionsPlugin) regionsPlugin.clearRegions();
                activeLoopRegion = null;
                hasActiveLoop.value = false;
            }
        };

        const togglePeersList = () => { showPeersList.value = !showPeersList.value; };
        const closePopups = () => { 
            showPeersList.value = false; 
            showHighlightPicker.value = false;
        };
        const formatTime = (seconds) => {
            const m = Math.floor(seconds / 60).toString().padStart(2, '0');
            const s = Math.floor(seconds % 60).toString().padStart(2, '0');
            const ms = Math.floor((seconds % 1) * 10).toString();
            return `${m}:${s}.${ms}`;
        };

        watch(autoScroll, (newVal) => { if (ws) ws.setOptions({ autoCenter: newVal }); });

        watch(currentTime, async (newTime) => {
            if (highlightActiveSegment.value) {
                updateActiveSegmentHighlight(newTime);
            }
            if (isLoopMode.value && isPlaying.value && activeLoopRegion) {
                if (newTime >= activeLoopRegion.end) {
                    ws.pause();
                    loopTimeout = setTimeout(() => {
                        if (isLoopMode.value && activeLoopRegion) {
                            ws.setTime(activeLoopRegion.start);
                            ws.play();
                        }
                    }, 1000);
                }
            }
        });

        return {
            locale, t, toggleLocale, sessionMode, setMode, isSessionStarted, isConnectingP2P, connectionState, syncError,
            connectionErrorMsg, highlightErrors, audioUrl, audioFileName, jsonFileName, userName, roomName, roomPassword,
            showRoomPassword, isRoomCopied, copyRoomDetails,
            serverPreset, customServerUrl, isReadyToStart, isDraggingAudio, isDraggingJson, handleStartAudio, handleStartJson,
            handleAudioDrop, handleJsonDrop, startSession, connectedPeers, peersList, showPeersList, togglePeersList,
            currentTime, isPlaying, isAudioReady, zoomLevel, zoomIn, zoomOut, freqMinInput, freqMaxInput, freqLabels,
            applyFrequencyRange, waveformRef, autoScroll,
            isLoopMode, hasActiveLoop, isDraggingWave, onWaveWheel, onWavePointerDown,
            onWavePointerMove, onWavePointerUp, togglePlay, onZoom, jumpTo, toggleLoopMode, colorSwatches, closePopups,
            formatTime, localJsonBuffer, editorRef, applyHighlight,
            setAlignment, currentAlignment, highlightActiveSegment, seekOnClick,
            isTextSelected, showHighlightPicker, toggleHighlightPicker, highlightColors, clearHighlight,
            commentsList, activeCommentId, selectComment, jumpToCommentInEditor, startEditComment, saveCommentEdit,
            cancelCommentEdit, deleteComment, editingCommentId, editingCommentText, replyInputText, addReply, deleteReply,
            addCommentAtSelection, formatCommentTime, exportJson,
            activeProposal, baselineSnapshot, isCommentNew, isReplyNew, proposalFileInput, handleProposalFileChange,
            previewProposal, acceptProposal, rejectProposal
        };
    }
}).mount('#app');