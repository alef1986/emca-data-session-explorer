/**
 * Document and JSON exporters for EMCA Data Session Explorer.
 */

import { Document, Packer, Paragraph, TextRun, CommentReference, CommentRangeStart, CommentRangeEnd } from 'https://esm.sh/docx@8.5.0';
import { uint8ArrayToBase64, downloadBlob } from './utils.js';

export { Document, Packer, Paragraph, TextRun, CommentReference, CommentRangeStart, CommentRangeEnd };

export const exportJson = async ({ ydoc, yMeta = null, audioFileName = '', comments = [] }) => {
    if (!ydoc) return;
    try {
        const yjsModule = await import('https://esm.sh/yjs@13.6.18');
        const Y = yjsModule.default || yjsModule;

        const update = Y.encodeStateAsUpdate(ydoc);
        const base64State = uint8ArrayToBase64(update);

        const currentTranscriptId = (yMeta && yMeta.get('transcriptId')) 
            ? yMeta.get('transcriptId') 
            : ('tr_' + Date.now());

        const rawComments = Array.isArray(comments) ? comments : (comments?.value || []);

        const payload = {
            version: '2.0',
            transcriptId: currentTranscriptId,
            exportedAt: new Date().toISOString(),
            audioFileName: audioFileName || '',
            comments: rawComments,
            _yjs_state: base64State
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const baseName = (audioFileName || 'session').replace(/\.[^/.]+$/, '');
        downloadBlob(blob, `${baseName}_annotated.json`);
    } catch (err) {
        console.error('Export error:', err);
    }
};

export const buildDocxComments = (comments) => {
    const commentIdMap = new Map();
    let nextId = 1;
    const docxComments = [];

    for (const c of (comments || [])) {
        if (!c || !c.id) continue;
        const numId = nextId++;
        commentIdMap.set(c.id, numId);

        const children = [];
        if (c.text) children.push(new Paragraph({ text: c.text }));
        if (Array.isArray(c.replies)) {
            for (const reply of c.replies) {
                if (!reply) continue;
                children.push(new Paragraph({ text: `[${reply.author || 'User'}]: ${reply.text || ''}` }));
            }
        }
        if (children.length === 0) children.push(new Paragraph({ text: '' }));

        let parsedDate = undefined;
        if (c.createdAt) {
            const d = new Date(c.createdAt);
            if (!isNaN(d.getTime())) parsedDate = d;
        }

        docxComments.push({
            id: numId,
            author: c.author || 'User',
            date: parsedDate,
            children
        });
    }
    return { commentIdMap, docxComments, getNextId: () => nextId++ };
};

export const makeDocxTextRun = (inlineNode) => {
    const runOptions = { text: inlineNode.text || '' };
    if (inlineNode.marks && inlineNode.marks.length > 0) {
        const colorMark = inlineNode.marks.find(m => m.type === 'textColor');
        if (colorMark?.attrs?.color) {
            runOptions.color = colorMark.attrs.color.replace('#', '');
        }
        const tcMark = inlineNode.marks.find(m => m.type === 'timecode');
        if (tcMark) {
            runOptions.shading = { fill: 'F3F4F6' };
        }
        if (inlineNode.marks.some(m => m.type === 'bold')) runOptions.bold = true;
        if (inlineNode.marks.some(m => m.type === 'underline')) runOptions.underline = {};
        if (inlineNode.marks.some(m => m.type === 'italic')) runOptions.italics = true;
        if (inlineNode.marks.some(m => m.type === 'strike')) runOptions.strike = true;
    }
    return new TextRun(runOptions);
};


export const exportWord = async ({ editor, comments = [], audioFileName = '' }) => {
    if (!editor) return;
    try {
        const editorData = editor.getJSON();
        const rawComments = Array.isArray(comments) ? comments : (comments?.value || []);
        const { commentIdMap, docxComments, getNextId } = buildDocxComments(rawComments);

        const docxParagraphs = [];
        const contentNodes = editorData?.content || [];
        const referencedCommentIds = new Set();
        let docxLineIndex = 1;

        for (const node of contentNodes) {
            const paragraphChildren = [];

            if (node.type === 'paragraph') {
                const lineLabel = String(docxLineIndex++).padStart(3, '0');
                paragraphChildren.push(new TextRun({
                    text: `${lineLabel}  `,
                    color: '94a3b8',
                    font: 'Consolas'
                }));
            }

            const inlineNodes = node.content || [];

            for (let i = 0; i < inlineNodes.length; i++) {
                const child = inlineNodes[i];
                if (child.type !== 'text') {
                    if (child.type === 'hardBreak') {
                        paragraphChildren.push(new TextRun({ break: 1 }));
                    }
                    continue;
                }

                const commentMark = child.marks?.find(m => m.type === 'comment');
                const commentId = commentMark?.attrs?.commentId;

                let numericId = null;
                if (commentId) {
                    if (!commentIdMap.has(commentId)) {
                        const newNumId = getNextId();
                        commentIdMap.set(commentId, newNumId);
                        docxComments.push({
                            id: newNumId,
                            author: 'User',
                            date: new Date(),
                            children: [new Paragraph({ text: '' })]
                        });
                    }
                    numericId = commentIdMap.get(commentId);
                }

                if (numericId !== null && numericId !== undefined) {
                    if (referencedCommentIds.has(numericId)) {
                        const orig = docxComments.find(c => c.id === numericId);
                        const freshNumId = getNextId();
                        docxComments.push({
                            id: freshNumId,
                            author: orig?.author || 'User',
                            date: orig?.date,
                            children: orig?.children || [new Paragraph({ text: '' })]
                        });
                        numericId = freshNumId;
                    }
                    referencedCommentIds.add(numericId);

                    paragraphChildren.push(new CommentRangeStart(numericId));
                    paragraphChildren.push(makeDocxTextRun(child));

                    while (i + 1 < inlineNodes.length) {
                        const nextChild = inlineNodes[i + 1];
                        if (nextChild.type !== 'text') break;
                        const nextCommentMark = nextChild.marks?.find(m => m.type === 'comment');
                        const nextCommentId = nextCommentMark?.attrs?.commentId;
                        if (nextCommentId !== commentId) break;

                        i++;
                        paragraphChildren.push(makeDocxTextRun(nextChild));
                    }

                    paragraphChildren.push(new CommentRangeEnd(numericId));
                    paragraphChildren.push(new CommentReference(numericId));
                } else {
                    paragraphChildren.push(makeDocxTextRun(child));
                }
            }

            let paragraphAlignment = undefined;
            if (node.attrs?.textAlign === 'justify') {
                paragraphAlignment = 'both';
            } else if (node.attrs?.textAlign === 'right') {
                paragraphAlignment = 'right';
            } else if (node.attrs?.textAlign === 'center') {
                paragraphAlignment = 'center';
            }

            docxParagraphs.push(new Paragraph({
                alignment: paragraphAlignment,
                spacing: { line: 360, after: 120 },
                children: paragraphChildren
            }));
        }

        const doc = new Document({
            comments: {
                children: docxComments
            },
            sections: [{
                properties: {},
                children: docxParagraphs
            }]
        });

        const blob = await Packer.toBlob(doc);
        const resolvedAudioFileName = typeof audioFileName === 'object' ? audioFileName.value : audioFileName;
        const baseName = (resolvedAudioFileName || 'session').replace(/\.[^/.]+$/, '');
        downloadBlob(blob, `${baseName}_annotated.docx`);
    } catch (err) {
        console.error('Word export error:', err);
    }
};
