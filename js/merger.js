/**
 * Offline multi-JSON merger workflow for EMCA Data Session Explorer.
 */

import { uint8ArrayToBase64, base64ToUint8Array, downloadBlob } from './utils.js';
import { Editor, StarterKit, Underline, TextAlign, Collaboration, TimecodeMark, CommentMark, TextColorMark } from './editor.js';

export const extractNodeText = (node) => {
    if (!node) return '';
    if (node.text) return node.text;
    if (Array.isArray(node.content)) {
        return node.content.map(extractNodeText).join('');
    }
    return '';
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getMatchingSuffixLength = (s1, s2) => {
    if (!s1 || !s2) return 0;
    const str1 = s1.toLowerCase();
    const str2 = s2.toLowerCase();
    let len = 0;
    while (len < str1.length && len < str2.length) {
        if (str1[str1.length - 1 - len] === str2[str2.length - 1 - len]) {
            len++;
        } else {
            break;
        }
    }
    return len;
};

const getMatchingPrefixLength = (s1, s2) => {
    if (!s1 || !s2) return 0;
    const str1 = s1.toLowerCase();
    const str2 = s2.toLowerCase();
    let len = 0;
    while (len < str1.length && len < str2.length) {
        if (str1[len] === str2[len]) {
            len++;
        } else {
            break;
        }
    }
    return len;
};

export const extractAnchoredAnnotations = (pmDoc) => {
    if (!pmDoc) return [];

    const tokens = [];
    pmDoc.descendants((node, pos) => {
        if (node.isText) {
            const tcMark = node.marks?.find(m => m.type.name === 'timecode');
            const rawStart = tcMark && tcMark.attrs?.start != null ? parseFloat(tcMark.attrs.start) : null;
            const rawEnd = tcMark && tcMark.attrs?.end != null ? parseFloat(tcMark.attrs.end) : null;
            const start = rawStart !== null && !isNaN(rawStart) ? rawStart : null;
            const end = rawEnd !== null && !isNaN(rawEnd) ? rawEnd : null;

            tokens.push({
                pos,
                endPos: pos + node.text.length,
                text: node.text,
                start,
                end,
                marks: node.marks || []
            });
        }
    });

    const TARGET_MARKS = ['comment', 'textColor', 'bold', 'underline'];
    const annotations = [];

    const areAttrsEqual = (markType, a1, a2) => {
        if (!a1 && !a2) return true;
        if (!a1 || !a2) return false;
        if (markType === 'comment') return a1.commentId === a2.commentId;
        if (markType === 'textColor') return a1.color === a2.color;
        return true;
    };

    for (const targetType of TARGET_MARKS) {
        let currentSpan = null;

        const closeCurrentSpan = () => {
            if (!currentSpan) return;
            const leftText = pmDoc.textBetween(Math.max(0, currentSpan.from - 60), currentSpan.from, ' ');
            const rightText = pmDoc.textBetween(currentSpan.to, Math.min(pmDoc.content.size, currentSpan.to + 60), ' ');

            annotations.push({
                markType: currentSpan.markType,
                attrs: currentSpan.attrs,
                text: currentSpan.text,
                start: currentSpan.start,
                end: currentSpan.end,
                leftContext: leftText.slice(-25),
                rightContext: rightText.slice(0, 25),
                from: currentSpan.from,
                to: currentSpan.to
            });
            currentSpan = null;
        };

        for (let idx = 0; idx < tokens.length; idx++) {
            const tok = tokens[idx];
            const mark = tok.marks.find(m => m.type.name === targetType);

            if (mark) {
                const isAdjacent = currentSpan && currentSpan.lastTokenIndex === idx - 1;
                const matchesAttrs = currentSpan && areAttrsEqual(targetType, currentSpan.attrs, mark.attrs);

                if (isAdjacent && matchesAttrs) {
                    if (tok.pos > currentSpan.endPos) {
                        currentSpan.text += ' ' + tok.text;
                    } else {
                        currentSpan.text += tok.text;
                    }
                    currentSpan.endPos = tok.endPos;
                    currentSpan.to = tok.endPos;
                    currentSpan.lastTokenIndex = idx;
                    if (currentSpan.start == null && tok.start != null) currentSpan.start = tok.start;
                    if (tok.end != null) currentSpan.end = tok.end;
                } else {
                    closeCurrentSpan();
                    currentSpan = {
                        markType: targetType,
                        attrs: mark.attrs ? { ...mark.attrs } : {},
                        text: tok.text,
                        from: tok.pos,
                        to: tok.endPos,
                        endPos: tok.endPos,
                        lastTokenIndex: idx,
                        start: tok.start,
                        end: tok.end
                    };
                }
            } else {
                closeCurrentSpan();
            }
        }
        closeCurrentSpan();
    }

    return annotations;
};

export const buildDocCharIndex = (pmDoc) => {
    if (!pmDoc) return { charIndex: [], fullText: '' };
    const charIndex = [];
    pmDoc.descendants((node, pos) => {
        if (node.isText) {
            const tcMark = node.marks?.find(m => m.type.name === 'timecode');
            const rawStart = tcMark && tcMark.attrs?.start != null ? parseFloat(tcMark.attrs.start) : null;
            const rawEnd = tcMark && tcMark.attrs?.end != null ? parseFloat(tcMark.attrs.end) : null;
            const start = rawStart !== null && !isNaN(rawStart) ? rawStart : null;
            const end = rawEnd !== null && !isNaN(rawEnd) ? rawEnd : null;

            for (let i = 0; i < node.text.length; i++) {
                charIndex.push({
                    char: node.text[i],
                    pos: pos + i,
                    start,
                    end
                });
            }
        } else if (node.isBlock) {
            if (charIndex.length > 0 && charIndex[charIndex.length - 1].char !== ' ' && charIndex[charIndex.length - 1].char !== '\n') {
                charIndex.push({
                    char: ' ',
                    pos: null,
                    start: null,
                    end: null
                });
            }
        }
    });
    const fullText = charIndex.map(c => c.char).join('');
    return { charIndex, fullText };
};

export const findAnchorInDoc = (pmDoc, anchor, prebuiltIndex = null) => {
    if (!pmDoc || !anchor || !anchor.text || typeof anchor.text !== 'string') return null;

    const { charIndex, fullText } = prebuiltIndex || buildDocCharIndex(pmDoc);
    if (!fullText || charIndex.length === 0) return null;

    const tokens = anchor.text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;

    const patternStr = tokens.map(escapeRegex).join('\\s+');
    let regex = new RegExp(patternStr, 'g');
    let matchArr = [];
    let m;
    while ((m = regex.exec(fullText)) !== null) {
        matchArr.push({ index: m.index, length: m[0].length });
        if (regex.lastIndex === m.index) regex.lastIndex++;
    }

    if (matchArr.length === 0) {
        regex = new RegExp(patternStr, 'gi');
        while ((m = regex.exec(fullText)) !== null) {
            matchArr.push({ index: m.index, length: m[0].length });
            if (regex.lastIndex === m.index) regex.lastIndex++;
        }
    }

    if (matchArr.length === 0) return null;

    const candidates = [];
    for (const match of matchArr) {
        const matchEnd = match.index + match.length;
        let startEntry = null;
        for (let k = match.index; k < matchEnd; k++) {
            if (charIndex[k]?.pos != null) {
                startEntry = charIndex[k];
                break;
            }
        }
        let endEntry = null;
        for (let k = matchEnd - 1; k >= match.index; k--) {
            if (charIndex[k]?.pos != null) {
                endEntry = charIndex[k];
                break;
            }
        }
        if (!startEntry || !endEntry) continue;

        const from = startEntry.pos;
        const to = endEntry.pos + 1;
        if (from >= to || from < 0 || to > pmDoc.content.size) continue;

        let candStart = null;
        let candEnd = null;
        for (let k = match.index; k < matchEnd; k++) {
            const entry = charIndex[k];
            if (entry && entry.start != null) {
                if (candStart === null || entry.start < candStart) candStart = entry.start;
            }
            if (entry && entry.end != null) {
                if (candEnd === null || entry.end > candEnd) candEnd = entry.end;
            }
        }

        const candLeft = fullText.slice(Math.max(0, match.index - 50), match.index);
        const candRight = fullText.slice(matchEnd, matchEnd + 50);

        const leftScore = getMatchingSuffixLength(anchor.leftContext, candLeft);
        const rightScore = getMatchingPrefixLength(anchor.rightContext, candRight);
        const contextScore = leftScore + rightScore;

        candidates.push({
            from,
            to,
            candStart,
            candEnd,
            contextScore
        });
    }

    if (candidates.length === 0) return null;

    // Pass 1: Timecode-constrained match
    if (anchor.start != null && typeof anchor.start === 'number' && !isNaN(anchor.start)) {
        const winStart = anchor.start - 2.0;
        const winEnd = (anchor.end != null && !isNaN(anchor.end) ? anchor.end : anchor.start) + 2.0;

        const timecodeCandidates = candidates.filter(cand => {
            if (cand.candStart == null) return false;
            if (cand.candEnd != null) {
                return cand.candStart <= winEnd && cand.candEnd >= winStart;
            }
            return cand.candStart <= winEnd && cand.candStart >= winStart;
        });

        if (timecodeCandidates.length > 0) {
            timecodeCandidates.sort((a, b) => {
                if (b.contextScore !== a.contextScore) {
                    return b.contextScore - a.contextScore;
                }
                const distA = Math.abs((a.candStart ?? 0) - anchor.start);
                const distB = Math.abs((b.candStart ?? 0) - anchor.start);
                return distA - distB;
            });
            const best = timecodeCandidates[0];
            return { from: best.from, to: best.to };
        }
    }

    // Pass 2: Global context fallback
    if (candidates.length === 1) {
        return { from: candidates[0].from, to: candidates[0].to };
    }

    candidates.sort((a, b) => b.contextScore - a.contextScore);
    const topCand = candidates[0];
    const secondCand = candidates[1];

    if (topCand.contextScore === 0) {
        return null;
    }

    if (topCand.contextScore === secondCand?.contextScore && topCand.contextScore < 4) {
        return null;
    }

    return { from: topCand.from, to: topCand.to };
};
export const applyTransplantedMarksToEditor = (editorInstance, markOperations) => {
    if (!editorInstance || !Array.isArray(markOperations) || markOperations.length === 0) return;
    const { state, view } = editorInstance;
    if (!state) return;
    const { schema } = state;
    const tr = state.tr;
    let appliedCount = 0;

    for (const op of markOperations) {
        if (!op || !op.targetRange) continue;
        const { from, to } = op.targetRange;
        if (typeof from !== 'number' || typeof to !== 'number' || from >= to) continue;
        if (from < 0 || to > tr.doc.content.size) continue;

        const markTypeObj = schema.marks[op.markType];
        if (!markTypeObj) continue;

        let alreadyExists = false;
        tr.doc.nodesBetween(from, to, (node) => {
            if (!node.isText) return;
            const match = node.marks.some(m => {
                if (m.type !== markTypeObj) return false;
                if (!op.attrs || Object.keys(op.attrs).length === 0) return true;
                return Object.keys(op.attrs).every(k => m.attrs[k] === op.attrs[k]);
            });
            if (match) alreadyExists = true;
        });

        if (alreadyExists) continue;

        const mark = markTypeObj.create(op.attrs || {});
        tr.addMark(from, to, mark);
        appliedCount++;
    }

    if (appliedCount > 0) {
        if (view && typeof view.dispatch === 'function') {
            view.dispatch(tr);
        }
    }
};


export const detectFileChanges = (kParagraphs, kComments, fileK, fIdx, baseParagraphs, baseCommentsMap) => {
    const changes = [];
    const maxP = Math.max(baseParagraphs.length, kParagraphs.length);

    for (let pIdx = 0; pIdx < maxP; pIdx++) {
        const baseP = baseParagraphs[pIdx];
        const newP = kParagraphs[pIdx];

        if (!baseP && newP) {
            changes.push({
                id: `p_${fIdx}_${pIdx}`,
                type: 'transcript',
                sourceFileIndex: fIdx + 1,
                sourceFileName: fileK.name,
                sourceAuthor: fileK.author,
                paragraphIndex: pIdx,
                lineNumber: pIdx + 1,
                diffType: 'added',
                baseText: '',
                newText: extractNodeText(newP),
                baseNode: null,
                newNode: newP,
                status: 'pending'
            });
        } else if (baseP && newP && JSON.stringify(baseP) !== JSON.stringify(newP)) {
            const baseText = extractNodeText(baseP);
            const newText = extractNodeText(newP);
            changes.push({
                id: `p_${fIdx}_${pIdx}`,
                type: 'transcript',
                sourceFileIndex: fIdx + 1,
                sourceFileName: fileK.name,
                sourceAuthor: fileK.author,
                paragraphIndex: pIdx,
                lineNumber: pIdx + 1,
                diffType: baseText !== newText ? 'text' : 'format',
                baseText: baseText,
                newText: newText,
                baseNode: baseP,
                newNode: newP,
                status: 'pending'
            });
        }
    }

    for (const c of kComments) {
        if (!c || !c.id) continue;
        if (!baseCommentsMap.has(c.id)) {
            changes.push({
                id: `c_${fIdx}_${c.id}`,
                type: 'comment',
                sourceFileIndex: fIdx + 1,
                sourceFileName: fileK.name,
                sourceAuthor: c.author || fileK.author,
                commentId: c.id,
                commentObj: c,
                quote: c.quote || '',
                text: c.text || '',
                isNew: true,
                status: 'pending'
            });
        } else {
            const baseC = baseCommentsMap.get(c.id);
            if (c.text && c.text !== baseC.text) {
                changes.push({
                    id: `c_edit_${fIdx}_${c.id}`,
                    type: 'comment',
                    sourceFileIndex: fIdx + 1,
                    sourceFileName: fileK.name,
                    sourceAuthor: c.author || fileK.author,
                    commentId: c.id,
                    commentObj: c,
                    quote: c.quote || '',
                    baseText: baseC.text || '',
                    text: c.text,
                    isNew: false,
                    status: 'pending'
                });
            }

            const baseReplies = new Set((baseC.replies || []).map(r => r.id));
            for (const r of (c.replies || [])) {
                if (r && r.id && !baseReplies.has(r.id)) {
                    changes.push({
                        id: `r_${fIdx}_${c.id}_${r.id}`,
                        type: 'reply',
                        sourceFileIndex: fIdx + 1,
                        sourceFileName: fileK.name,
                        sourceAuthor: r.author || fileK.author,
                        commentId: c.id,
                        replyId: r.id,
                        replyObj: r,
                        parentQuote: c.quote || '',
                        text: r.text || '',
                        status: 'pending'
                    });
                }
            }
        }
    }
    return changes;
};
export const detectCrossBaselineChanges = ({ tempEditorK, tempEditor1, baseCharIndex, fileK, fIdx, baseCommentsMap }) => {
    const kAnchors = extractAnchoredAnnotations(tempEditorK.state.doc);
    const kComments = fileK.parsed?.comments || [];
    const kCommentsMap = new Map(kComments.map(c => [c.id, c]));
    const processedCommentIds = new Set();
    const crossChanges = [];

    for (const anchor of kAnchors) {
        if (anchor.markType === 'comment') {
            const commentId = anchor.attrs?.commentId;
            if (commentId && !baseCommentsMap.has(commentId)) {
                if (!processedCommentIds.has(commentId)) {
                    processedCommentIds.add(commentId);
                    const targetRange = findAnchorInDoc(tempEditor1.state.doc, anchor, baseCharIndex);
                    const commentObj = kCommentsMap.get(commentId) || { id: commentId, text: anchor.text, quote: anchor.text, author: fileK.author };
                    crossChanges.push({
                        id: `c_${fIdx}_${commentId}`,
                        type: 'comment',
                        isCrossBaseline: true,
                        sourceFileIndex: fIdx + 1,
                        sourceFileName: fileK.name,
                        sourceAuthor: commentObj.author || fileK.author,
                        commentId,
                        commentObj,
                        quote: commentObj.quote || anchor.text || '',
                        text: commentObj.text || '',
                        targetRange,
                        unanchored: !targetRange,
                        status: 'pending'
                    });
                }
            }
        } else if (['textColor', 'bold', 'underline'].includes(anchor.markType)) {
            const targetRange = findAnchorInDoc(tempEditor1.state.doc, anchor, baseCharIndex);
            if (targetRange) {
                let alreadyMarked = false;
                tempEditor1.state.doc.nodesBetween(targetRange.from, targetRange.to, (node) => {
                    if (!node.isText) return;
                    const match = node.marks.some(m => {
                        if (m.type.name !== anchor.markType) return false;
                        if (!anchor.attrs || Object.keys(anchor.attrs).length === 0) return true;
                        return Object.keys(anchor.attrs).every(k => m.attrs[k] === anchor.attrs[k]);
                    });
                    if (match) alreadyMarked = true;
                });

                if (!alreadyMarked) {
                    const resolved = tempEditor1.state.doc.resolve(targetRange.from);
                    const pIndex = resolved.index(0);
                    const lineNumber = pIndex + 1;
                    crossChanges.push({
                        id: `m_${fIdx}_${anchor.markType}_${targetRange.from}_${targetRange.to}`,
                        type: 'transcript',
                        diffType: 'mark_transplant',
                        isCrossBaseline: true,
                        sourceFileIndex: fIdx + 1,
                        sourceFileName: fileK.name,
                        sourceAuthor: fileK.author,
                        paragraphIndex: pIndex,
                        lineNumber,
                        targetRange,
                        markType: anchor.markType,
                        attrs: anchor.attrs,
                        baseText: '',
                        newText: anchor.text,
                        status: 'pending'
                    });
                }
            }
        }
    }

    for (const c of kComments) {
        if (!c || !c.id) continue;
        if (baseCommentsMap.has(c.id)) continue;
        if (!processedCommentIds.has(c.id)) {
            processedCommentIds.add(c.id);
            crossChanges.push({
                id: `c_${fIdx}_${c.id}`,
                type: 'comment',
                isCrossBaseline: true,
                sourceFileIndex: fIdx + 1,
                sourceFileName: fileK.name,
                sourceAuthor: c.author || fileK.author,
                commentId: c.id,
                commentObj: c,
                quote: c.quote || '',
                text: c.text || '',
                targetRange: null,
                unanchored: true,
                status: 'pending'
            });
        }
    }

    for (const c of kComments) {
        if (!c || !c.id) continue;
        if (baseCommentsMap.has(c.id)) {
            const baseC = baseCommentsMap.get(c.id);
            if (Array.isArray(c.replies)) {
                const baseReplies = new Set((baseC.replies || []).map(r => r.id));
                for (const r of c.replies) {
                    if (r && r.id && !baseReplies.has(r.id)) {
                        crossChanges.push({
                            id: `r_${fIdx}_${c.id}_${r.id}`,
                            type: 'reply',
                            isCrossBaseline: true,
                            sourceFileIndex: fIdx + 1,
                            sourceFileName: fileK.name,
                            sourceAuthor: r.author || fileK.author,
                            commentId: c.id,
                            replyId: r.id,
                            replyObj: r,
                            parentQuote: c.quote || '',
                            text: r.text || '',
                            status: 'pending'
                        });
                    }
                }
            }
        }
    }

    return crossChanges;
};



export const rebuildMergePreview = ({ mergeEditorInstance, mergeBaseParagraphs, mergeChanges }) => {
    if (!mergeEditorInstance || !mergeBaseParagraphs) return;
    try {
        const content = mergeBaseParagraphs.map(p => JSON.parse(JSON.stringify(p)));
        const acceptedChanges = mergeChanges.filter(c => c.type === 'transcript' && c.status === 'accepted');

        for (const ch of acceptedChanges) {
            if (ch.diffType !== 'added' && ch.diffType !== 'mark_transplant' && ch.newNode && ch.paragraphIndex < content.length) {
                content[ch.paragraphIndex] = JSON.parse(JSON.stringify(ch.newNode));
            }
        }

        const addedChanges = acceptedChanges
            .filter(ch => ch.diffType === 'added' && ch.newNode)
            .sort((a, b) => a.paragraphIndex - b.paragraphIndex);

        for (const ch of addedChanges) {
            if (ch.paragraphIndex >= content.length) {
                content.push(JSON.parse(JSON.stringify(ch.newNode)));
            } else {
                content.splice(ch.paragraphIndex, 0, JSON.parse(JSON.stringify(ch.newNode)));
            }
        }

        mergeEditorInstance.commands.setContent({
            type: 'doc',
            content: content
        });

        const markOperations = [];
        for (const ch of mergeChanges) {
            if (ch.status !== 'accepted') continue;
            if (ch.type === 'transcript' && ch.diffType === 'mark_transplant' && ch.targetRange) {
                markOperations.push({
                    targetRange: ch.targetRange,
                    markType: ch.markType,
                    attrs: ch.attrs
                });
            } else if (ch.type === 'comment' && ch.targetRange) {
                markOperations.push({
                    targetRange: ch.targetRange,
                    markType: 'comment',
                    attrs: { commentId: ch.commentId }
                });
            }
        }
        if (markOperations.length > 0) {
            applyTransplantedMarksToEditor(mergeEditorInstance, markOperations);
        }
    } catch (e) {
        console.error('Error rebuilding merge preview:', e);
    }
};

export const filterMergeChanges = (changes, filter = 'all', searchQuery = '') => {
    if (!Array.isArray(changes)) return [];
    return changes.filter(item => {
        if (filter === 'transcript' && item.type !== 'transcript') return false;
        if (filter === 'comments' && item.type !== 'comment') return false;
        if (filter === 'replies' && item.type !== 'reply') return false;
        if (searchQuery && searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            const textToSearch = `${item.sourceAuthor || ''} ${item.sourceFileName || ''} ${item.baseText || ''} ${item.newText || ''} ${item.text || ''} ${item.quote || ''}`.toLowerCase();
            if (!textToSearch.includes(q)) return false;
        }
        return true;
    });
};

export const summarizeMergeChanges = (changes) => {
    if (!Array.isArray(changes)) {
        return { total: 0, accepted: 0, rejected: 0, pending: 0, transcript: 0, comments: 0, replies: 0 };
    }
    const total = changes.length;
    const accepted = changes.filter(c => c.status === 'accepted').length;
    const rejected = changes.filter(c => c.status === 'rejected').length;
    const pending = changes.filter(c => c.status === 'pending').length;
    const transcript = changes.filter(c => c.type === 'transcript').length;
    const comments = changes.filter(c => c.type === 'comment').length;
    const replies = changes.filter(c => c.type === 'reply').length;
    return { total, accepted, rejected, pending, transcript, comments, replies };
};

export const createMergePreviewEditor = ({ element, content }) => {
    return new Editor({
        element,
        editable: false,
        extensions: [
            StarterKit.configure({ history: false }),
            Underline,
            TimecodeMark,
            CommentMark,
            TextColorMark,
            TextAlign.configure({ types: ['heading', 'paragraph'] })
        ],
        editorProps: {
            attributes: {
                class: 'prose max-w-none focus:outline-none min-h-[300px] leading-relaxed p-4 bg-gray-50/50',
                spellcheck: 'false',
            },
        },
        content: {
            type: 'doc',
            content: content
        }
    });
};


export const saveMergedBaseline = async ({ mergeFiles, mergeChanges, mergeBaseParagraphs }) => {
    if (!mergeFiles || mergeFiles.length === 0) return false;
    try {
        const yjsModule = await import('https://esm.sh/yjs@13.6.18');
        const Y = yjsModule.default || yjsModule;

        const file1 = mergeFiles[0];
        const finalDoc = new Y.Doc();
        const finalMeta = finalDoc.getMap('emca-meta');

        const finalEditor = new Editor({
            extensions: [
                StarterKit.configure({ history: false }),
                Underline,
                TimecodeMark,
                CommentMark,
                TextColorMark,
                TextAlign.configure({ types: ['heading', 'paragraph'] }),
                Collaboration.configure({ document: finalDoc, field: 'emca-transcript' })
            ]
        });

        const finalContent = mergeBaseParagraphs.map(p => JSON.parse(JSON.stringify(p)));
        const acceptedChanges = mergeChanges.filter(c => c.type === 'transcript' && c.status === 'accepted');

        for (const ch of acceptedChanges) {
            if (ch.diffType !== 'added' && ch.diffType !== 'mark_transplant' && ch.newNode && ch.paragraphIndex < finalContent.length) {
                finalContent[ch.paragraphIndex] = JSON.parse(JSON.stringify(ch.newNode));
            }
        }

        const addedChanges = acceptedChanges
            .filter(ch => ch.diffType === 'added' && ch.newNode)
            .sort((a, b) => a.paragraphIndex - b.paragraphIndex);

        for (const ch of addedChanges) {
            if (ch.paragraphIndex >= finalContent.length) {
                finalContent.push(JSON.parse(JSON.stringify(ch.newNode)));
            } else {
                finalContent.splice(ch.paragraphIndex, 0, JSON.parse(JSON.stringify(ch.newNode)));
            }
        }

        finalEditor.commands.setContent({
            type: 'doc',
            content: finalContent
        });

        const markOperations = [];
        for (const ch of mergeChanges) {
            if (ch.status !== 'accepted') continue;
            if (ch.type === 'transcript' && ch.diffType === 'mark_transplant' && ch.targetRange) {
                markOperations.push({
                    targetRange: ch.targetRange,
                    markType: ch.markType,
                    attrs: ch.attrs
                });
            } else if (ch.type === 'comment' && ch.targetRange) {
                markOperations.push({
                    targetRange: ch.targetRange,
                    markType: 'comment',
                    attrs: { commentId: ch.commentId }
                });
            }
        }
        if (markOperations.length > 0) {
            applyTransplantedMarksToEditor(finalEditor, markOperations);
        }

        finalEditor.destroy();

        const baseComments = file1.parsed.comments || [];
        const finalCommentsMap = new Map();
        baseComments.forEach(c => {
            if (c && c.id) finalCommentsMap.set(c.id, JSON.parse(JSON.stringify(c)));
        });

        const acceptedComments = mergeChanges.filter(c => (c.type === 'comment' || c.type === 'reply') && c.status === 'accepted');

        for (const ac of acceptedComments) {
            if (ac.type === 'comment') {
                const existing = finalCommentsMap.get(ac.commentId);
                if (!existing) {
                    finalCommentsMap.set(ac.commentId, ac.commentObj);
                } else {
                    finalCommentsMap.set(ac.commentId, { ...existing, text: ac.text });
                }
            } else if (ac.type === 'reply' && ac.replyObj) {
                const parent = finalCommentsMap.get(ac.commentId);
                if (parent) {
                    const replies = Array.isArray(parent.replies) ? [...parent.replies] : [];
                    if (!replies.some(r => r.id === ac.replyId)) {
                        replies.push(ac.replyObj);
                        finalCommentsMap.set(ac.commentId, { ...parent, replies });
                    }
                }
            }
        }

        const newTranscriptId = 'tr_' + Date.now();
        finalMeta.set('transcriptId', newTranscriptId);
        finalMeta.set('version', '2.0');

        const finalCommentsYMap = finalDoc.getMap('emca-comments');
        finalCommentsMap.forEach((val, key) => {
            if (val) finalCommentsYMap.set(key, { ...val, id: key });
        });

        const finalUpdate = Y.encodeStateAsUpdate(finalDoc);
        const base64State = uint8ArrayToBase64(finalUpdate);

        const exportedComments = [];
        finalCommentsMap.forEach((val, key) => {
            if (val) exportedComments.push({ ...val, id: key });
        });

        const mergedPayload = {
            version: '2.0',
            transcriptId: newTranscriptId,
            exportedAt: new Date().toISOString(),
            audioFileName: file1.parsed.audioFileName || '',
            comments: exportedComments,
            _yjs_state: base64State
        };

        const blob = new Blob([JSON.stringify(mergedPayload, null, 2)], { type: 'application/json' });
        const baseName = (file1.name || 'session').replace(/\.[^/.]+$/, '');
        downloadBlob(blob, `${baseName}_merged_baseline.json`);
        finalDoc.destroy();
        return true;
    } catch (err) {
        console.error('Failed to save merged baseline:', err);
        throw err;
    }
};


export const parseMergeFileInput = async (file, existingFiles = [], t = (k) => k) => {
    if (!file.name.endsWith('.json')) {
        throw new Error(t('error_v2_required'));
    }
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed._yjs_state) {
        throw new Error(file.name + ': ' + t('error_v2_required'));
    }

    if (existingFiles.length > 0) {
        const baseId = existingFiles[0].transcriptId;
        if (baseId && parsed.transcriptId && baseId !== parsed.transcriptId) {
            const proceed = window.confirm(t('merge_confirm_different_transcripts', { file: file.name }));
            if (!proceed) return null;
        }
    }

    return {
        id: 'mf_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
        file: file,
        name: file.name,
        size: (file.size / 1024).toFixed(1) + ' KB',
        parsed: parsed,
        transcriptId: parsed.transcriptId || '',
        commentsCount: (parsed.comments || []).length,
        author: (parsed.comments && parsed.comments[0]?.author) || `Peer #${existingFiles.length + 1}`
    };
};

export const initMergeEditorWorkflow = async ({ mergeFiles, previewElement, t = (k) => k }) => {
    if (!mergeFiles || mergeFiles.length < 2) {
        throw new Error(t('merge_need_min_files'));
    }

    const yjsModule = await import('https://esm.sh/yjs@13.6.18');
    const Y = yjsModule.default || yjsModule;

    const file1 = mergeFiles[0];
    const baselineYDoc = new Y.Doc();
    Y.applyUpdate(baselineYDoc, base64ToUint8Array(file1.parsed._yjs_state));

    const tempEditor1 = new Editor({
        extensions: [
            StarterKit.configure({ history: false }),
            Underline,
            TimecodeMark,
            CommentMark,
            TextColorMark,
            TextAlign.configure({ types: ['heading', 'paragraph'] }),
            Collaboration.configure({ document: baselineYDoc, field: 'emca-transcript' })
        ]
    });
    const baseJson = tempEditor1.getJSON();
    const baseParagraphs = JSON.parse(JSON.stringify(baseJson?.content || []));
    const baseCharIndex = buildDocCharIndex(tempEditor1.state.doc);

    const baseComments = file1.parsed.comments || [];
    const baseCommentsMap = new Map(baseComments.map(c => [c.id, c]));

    let allDetectedChanges = [];

    for (let fIdx = 1; fIdx < mergeFiles.length; fIdx++) {
        const fileK = mergeFiles[fIdx];
        const docK = new Y.Doc();
        Y.applyUpdate(docK, base64ToUint8Array(fileK.parsed._yjs_state));

        const tempEditorK = new Editor({
            extensions: [
                StarterKit.configure({ history: false }),
                Underline,
                TimecodeMark,
                CommentMark,
                TextColorMark,
                TextAlign.configure({ types: ['heading', 'paragraph'] }),
                Collaboration.configure({ document: docK, field: 'emca-transcript' })
            ]
        });
        const kJson = tempEditorK.getJSON();
        const kParagraphs = kJson?.content || [];
        const kComments = fileK.parsed.comments || [];

        const isCrossBaseline = Boolean(!file1.transcriptId || !fileK.transcriptId || file1.transcriptId !== fileK.transcriptId);

        if (!isCrossBaseline) {
            const fileChanges = detectFileChanges(kParagraphs, kComments, fileK, fIdx, baseParagraphs, baseCommentsMap);
            allDetectedChanges = allDetectedChanges.concat(fileChanges);
        } else {
            const crossChanges = detectCrossBaselineChanges({
                tempEditorK,
                tempEditor1,
                baseCharIndex,
                fileK,
                fIdx,
                baseCommentsMap
            });
            allDetectedChanges = allDetectedChanges.concat(crossChanges);
        }

        tempEditorK.destroy();
        docK.destroy();
    }

    tempEditor1.destroy();

    let editorInstance = null;
    if (previewElement) {
        editorInstance = createMergePreviewEditor({
            element: previewElement,
            content: baseParagraphs
        });
    }

    return {
        changes: allDetectedChanges,
        baseParagraphs,
        baselineYDoc,
        editorInstance
    };
};


export const parseProposalFile = async (file, { currentTranscriptId, userName = 'Guest', t = (k) => k }) => {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed._yjs_state) {
        throw new Error(t('error_v2_required'));
    }

    const fileTranscriptId = parsed.transcriptId;
    const isCrossBaseline = Boolean(!currentTranscriptId || !fileTranscriptId || currentTranscriptId !== fileTranscriptId);

    if (isCrossBaseline) {
        const proceed = window.confirm(t('proposal_confirm_different_baseline', { file: file.name }));
        if (!proceed) return null;
    }

    const resolvedUser = (typeof userName === 'function' ? userName() : userName) || 'Guest';
    return {
        id: 'prop_' + Date.now(),
        author: resolvedUser.trim() || 'Guest',
        fileName: file.name,
        yjsState: parsed._yjs_state,
        comments: parsed.comments || [],
        createdAt: new Date().toISOString(),
        status: 'pending',
        isCrossBaseline
    };
};

export const previewProposalWorkflow = async ({ editor, ydoc, yComments, proposal, commentsList, setFormattingFlag }) => {
    if (!editor || !ydoc || !proposal || !proposal.yjsState) return null;

    const snapshot = {
        editorJson: editor.getJSON(),
        comments: JSON.parse(JSON.stringify(commentsList || [])),
        oldCommentIds: new Set((commentsList || []).map(c => c.id)),
        oldReplyIds: new Set((commentsList || []).flatMap(c => (c.replies || []).map(r => r.id)))
    };

    if (!proposal.isCrossBaseline) {
        const yjsModule = await import('https://esm.sh/yjs@13.6.18');
        const Y = yjsModule.default || yjsModule;
        const update = base64ToUint8Array(proposal.yjsState);
        Y.applyUpdate(ydoc, update);

        if (yComments && proposal.comments && Array.isArray(proposal.comments)) {
            const { mergeCommentsData } = await import('./utils.js');
            mergeCommentsData(yComments, proposal.comments);
        }

        return snapshot;
    }

    // Cross-baseline proposal workflow
    const yjsModule = await import('https://esm.sh/yjs@13.6.18');
    const Y = yjsModule.default || yjsModule;
    const tempYDoc = new Y.Doc();
    const update = base64ToUint8Array(proposal.yjsState);
    Y.applyUpdate(tempYDoc, update);

    const tempEditor = new Editor({
        extensions: [
            StarterKit.configure({ history: false }),
            Underline,
            TimecodeMark,
            CommentMark,
            TextColorMark,
            TextAlign.configure({ types: ['heading', 'paragraph'] }),
            Collaboration.configure({ document: tempYDoc, field: 'emca-transcript' })
        ]
    });

    try {
        const anchors = extractAnchoredAnnotations(tempEditor.state.doc);
        const hostCharIndex = buildDocCharIndex(editor.state.doc);
        const markOps = [];

        for (const anchor of anchors) {
            const targetRange = findAnchorInDoc(editor.state.doc, anchor, hostCharIndex);
            if (!targetRange) continue;
            markOps.push({
                targetRange,
                markType: anchor.markType,
                attrs: anchor.attrs
            });
        }

        if (setFormattingFlag) setFormattingFlag(true);
        try {
            applyTransplantedMarksToEditor(editor, markOps);
        } finally {
            if (setFormattingFlag) setFormattingFlag(false);
        }

        if (yComments && proposal.comments && Array.isArray(proposal.comments)) {
            const { mergeCommentsData } = await import('./utils.js');
            mergeCommentsData(yComments, proposal.comments);
        }
    } finally {
        tempEditor.destroy();
        tempYDoc.destroy();
    }

    return snapshot;
};

export const rejectProposalWorkflow = ({ editor, ydoc, yComments, baselineSnapshot, setFormattingFlag }) => {
    if (!baselineSnapshot) return;

    if (editor && baselineSnapshot.editorJson) {
        if (setFormattingFlag) setFormattingFlag(true);
        try {
            editor.commands.setContent(baselineSnapshot.editorJson);
        } finally {
            if (setFormattingFlag) setFormattingFlag(false);
        }
    }

    if (yComments && ydoc) {
        ydoc.transact(() => {
            const currentKeys = Array.from(yComments.keys());
            for (const key of currentKeys) {
                yComments.delete(key);
            }
            if (Array.isArray(baselineSnapshot.comments)) {
                baselineSnapshot.comments.forEach(comment => {
                    yComments.set(comment.id, comment);
                });
            }
        });
    }
};
