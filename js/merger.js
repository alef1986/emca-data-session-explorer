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


export const rebuildMergePreview = ({ mergeEditorInstance, mergeBaseParagraphs, mergeChanges }) => {
    if (!mergeEditorInstance || !mergeBaseParagraphs) return;
    try {
        const content = mergeBaseParagraphs.map(p => JSON.parse(JSON.stringify(p)));
        const acceptedChanges = mergeChanges.filter(c => c.type === 'transcript' && c.status === 'accepted');

        for (const ch of acceptedChanges) {
            if (ch.diffType !== 'added' && ch.newNode && ch.paragraphIndex < content.length) {
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
            if (ch.diffType !== 'added' && ch.newNode && ch.paragraphIndex < finalContent.length) {
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
    tempEditor1.destroy();

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
        tempEditorK.destroy();
        docK.destroy();

        const kComments = fileK.parsed.comments || [];
        const fileChanges = detectFileChanges(kParagraphs, kComments, fileK, fIdx, baseParagraphs, baseCommentsMap);
        allDetectedChanges = allDetectedChanges.concat(fileChanges);
    }

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
    if (!currentTranscriptId || !fileTranscriptId || currentTranscriptId !== fileTranscriptId) {
        throw new Error(t('error_different_baseline'));
    }

    const resolvedUser = (typeof userName === 'function' ? userName() : userName) || 'Guest';
    return {
        id: 'prop_' + Date.now(),
        author: resolvedUser.trim() || 'Guest',
        fileName: file.name,
        yjsState: parsed._yjs_state,
        comments: parsed.comments || [],
        createdAt: new Date().toISOString(),
        status: 'pending'
    };
};

export const previewProposalWorkflow = async ({ editor, ydoc, yComments, proposal, commentsList }) => {
    if (!editor || !ydoc || !proposal || !proposal.yjsState) return null;

    const snapshot = {
        editorJson: editor.getJSON(),
        comments: JSON.parse(JSON.stringify(commentsList || [])),
        oldCommentIds: new Set((commentsList || []).map(c => c.id)),
        oldReplyIds: new Set((commentsList || []).flatMap(c => (c.replies || []).map(r => r.id)))
    };

    const yjsModule = await import('https://esm.sh/yjs@13.6.18');
    const Y = yjsModule.default || yjsModule;
    const update = base64ToUint8Array(proposal.yjsState);
    Y.applyUpdate(ydoc, update);

    if (yComments && proposal.comments && Array.isArray(proposal.comments)) {
        const { mergeCommentsData } = await import('./utils.js');
        mergeCommentsData(yComments, proposal.comments);
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
