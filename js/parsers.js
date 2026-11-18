/**
 * Transcript parsers, formatters, and anonymization helpers for EMCA Data Session Explorer.
 */

import { escapeHtml, parseTimestampToSeconds } from './utils.js';

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


export const formatTranscriptToHtml = (segments, pauseThreshold = 0.8) => {
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
                rawText: unescapedText,
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
    let prevRawText = '';

    // Проверка на завершающий знак препинания (точка, !, ?, троеточие + возможные кавычки/скобки)
    const endsWithSentenceTerminator = (str) => /([.!?…]+)["'»”)\]]*$/.test((str || '').trim());

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
        const { start: safeStart, end: safeEnd, rawText, cleanText, speaker } = item;

        if (prevEnd === null) {
            currentParagraphSpeaker = speaker;
            currentParagraphSpans.push(`<span data-start="${safeStart}" data-end="${safeEnd}">${cleanText}</span>`);
            prevEnd = safeEnd;
            prevSpeaker = speaker;
            prevRawText = rawText;
            continue;
        }

        const isSpeakerChanged = Boolean(speaker && speaker !== prevSpeaker);
        const hasSentenceEnd = endsWithSentenceTerminator(prevRawText);
        const gap = safeStart - prevEnd;

        // Перенос строки делаем ТОЛЬКО при:
        // a) смене спикера (speaker && speaker !== prevSpeaker),
        // b) предыдущий сегмент оканчивается знаком препинания (. ! ? …) И есть пауза/граница (gap >= 0),
        // c) экстремальной тишине/паузе (> 8.0 секунд), где пунктуация в субтитрах могла отсутствовать.
        const shouldBreakOnSentence = hasSentenceEnd && gap >= 0;
        const isExtremeSilence = gap > 8.0;

        if (isSpeakerChanged || shouldBreakOnSentence || isExtremeSilence) {
            flushParagraph();
            currentParagraphSpeaker = speaker || prevSpeaker;
            currentParagraphSpans.push(`<span data-start="${safeStart}" data-end="${safeEnd}">${cleanText}</span>`);
        } else {
            currentParagraphSpans.push(`<span data-start="${safeStart}" data-end="${safeEnd}">${cleanText}</span>`);
        }

        prevEnd = Math.max(prevEnd, safeEnd);
        if (speaker) prevSpeaker = speaker;
        prevRawText = rawText;
    }

    flushParagraph();

    return paragraphs.join('');
};

export const anonymizeTranscriptSegments = (segments, prefix = 'Speaker') => {
    if (!Array.isArray(segments)) return segments;
    const speakerMap = new Map();
    let speakerCounter = 0;

    for (const seg of segments) {
        if (!seg) continue;
        const rawSpeaker = seg.speaker != null ? String(seg.speaker).trim() : '';
        if (!rawSpeaker) {
            seg.speaker = null;
        } else {
            if (!speakerMap.has(rawSpeaker)) {
                speakerCounter++;
                speakerMap.set(rawSpeaker, `${prefix} ${speakerCounter}`);
            }
            seg.speaker = speakerMap.get(rawSpeaker);
        }
    }
    return segments;
};

export const parseTranscriptContent = (rawText, fileName = '', options = {}) => {
    const rawContent = (rawText || '').replace(/^\uFEFF/, '');
    const nameLower = (fileName || '').toLowerCase();
    let result;

    if (nameLower.endsWith('.vtt')) {
        result = parseVttToSegments(rawContent);
    } else if (nameLower.endsWith('.srt')) {
        result = parseSrtToSegments(rawContent);
    } else {
        const parsed = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;
        result = normalizeJsonTranscript(parsed);
    }

    if (options.anonymize && Array.isArray(result)) {
        anonymizeTranscriptSegments(result, options.speakerPrefix || 'Speaker');
    }

    return result;
};


export const loadTranscriptIntoEditor = async ({
    editor,
    ydoc,
    yMeta,
    yComments,
    jsonBuffer,
    anonymize = false,
    speakerPrefix = 'Speaker',
    setInternalFormatting
}) => {
    if (!editor || !ydoc) return;
    if (yMeta && !yMeta.get('transcriptId')) {
        const tid = (jsonBuffer && typeof jsonBuffer === 'object' && !Array.isArray(jsonBuffer) && jsonBuffer.transcriptId)
            ? jsonBuffer.transcriptId
            : ('tr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));
        yMeta.set('transcriptId', tid);
    }
    
    let segmentsToRender = null;
    if (jsonBuffer && typeof jsonBuffer === 'object' && !Array.isArray(jsonBuffer)) {
        if (jsonBuffer._yjs_state) {
            try {
                const yjsModule = await import('https://esm.sh/yjs@13.6.18');
                const Y = yjsModule.default || yjsModule;
                const { base64ToUint8Array } = await import('./utils.js');
                const update = base64ToUint8Array(jsonBuffer._yjs_state);
                Y.applyUpdate(ydoc, update);
                if (yComments && Array.isArray(jsonBuffer.comments)) {
                    const { mergeCommentsData } = await import('./utils.js');
                    mergeCommentsData(yComments, jsonBuffer.comments);
                }
            } catch (e) {
                console.error('Error applying CRDT update:', e);
            }
            return;
        } else if (jsonBuffer.comments && yComments) {
            const { mergeCommentsData } = await import('./utils.js');
            mergeCommentsData(yComments, jsonBuffer.comments);
            if (jsonBuffer.content) {
                if (setInternalFormatting) setInternalFormatting(true);
                try {
                    editor.commands.setContent(jsonBuffer.content);
                } finally {
                    if (setInternalFormatting) setInternalFormatting(false);
                }
                return;
            }
        }
    } else if (Array.isArray(jsonBuffer)) {
        segmentsToRender = jsonBuffer;
    }

    if (segmentsToRender) {
        if (anonymize) {
            anonymizeTranscriptSegments(segmentsToRender, speakerPrefix);
        }
        const html = formatTranscriptToHtml(segmentsToRender);
        if (setInternalFormatting) setInternalFormatting(true);
        try {
            editor.chain().setContent(html, true, { preserveWhitespace: true }).setMeta('allow-init', true).run();
        } finally {
            if (setInternalFormatting) setInternalFormatting(false);
        }
    }
};
