/**
 * Pure shared helper utilities for EMCA Data Session Explorer.
 * Zero internal dependencies.
 */

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

export const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    const ms = Math.floor((seconds % 1) * 10).toString();
    return `${m}:${s}.${ms}`;
};

export const formatCommentTime = (isoString) => {
    if (!isoString) return '';
    try {
        const d = new Date(isoString);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    } catch {
        return '';
    }
};

export const uint8ArrayToBase64 = (bytes) => {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};

export const base64ToUint8Array = (base64) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

export const generateId = (prefix = 'id') => {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
};

export const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};

export const copyToClipboard = async (text) => {
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
};

export const debounce = (fn, delay = 200) => {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
};


export const mergeCommentsData = (yCommentsMap, incomingCommentsArray) => {
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


export const createCommentAtSelection = ({ editor, userName = 'Anonymous', yComments }) => {
    if (!editor) return null;
    const { from, to, empty } = editor.state.selection;
    if (empty || from >= to) return null;

    const quote = editor.state.doc.textBetween(from, to, ' ').trim().slice(0, 150);
    const commentId = generateId('c');

    editor.chain().focus().setMark('comment', { commentId }).run();

    const authorName = (typeof userName === 'function' ? userName() : userName) || 'Anonymous';
    const newComment = {
        id: commentId,
        author: authorName.trim() || 'Anonymous',
        text: '',
        quote: quote,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        replies: []
    };

    if (yComments) {
        yComments.set(commentId, newComment);
    }

    return newComment;
};

export const deleteCommentMarkAndData = ({ editor, yComments, commentId }) => {
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
};

export const saveCommentText = ({ yComments, commentId, text, onDelete }) => {
    if (!yComments) return;
    const existing = yComments.get(commentId);
    if (!existing) return;

    const trimmed = (text || '').trim();
    if (!trimmed && (!existing.replies || existing.replies.length === 0)) {
        if (onDelete) onDelete(commentId);
        return;
    }

    yComments.set(commentId, {
        ...existing,
        text: trimmed,
        updatedAt: new Date().toISOString()
    });
};

export const addCommentReply = ({ yComments, commentId, author = 'Anonymous', text }) => {
    const trimmed = (text || '').trim();
    if (!trimmed || !yComments) return null;

    const existing = yComments.get(commentId);
    if (!existing) return null;

    const replies = Array.isArray(existing.replies) ? [...existing.replies] : [];
    const authorName = (typeof author === 'function' ? author() : author) || 'Anonymous';
    const newReply = {
        id: generateId('r'),
        author: authorName.trim() || 'Anonymous',
        text: trimmed,
        createdAt: new Date().toISOString()
    };
    replies.push(newReply);

    yComments.set(commentId, {
        ...existing,
        replies,
        updatedAt: new Date().toISOString()
    });
    return newReply;
};

export const deleteCommentReply = ({ yComments, commentId, replyId }) => {
    if (!yComments) return;
    const existing = yComments.get(commentId);
    if (!existing || !Array.isArray(existing.replies)) return;

    const replies = existing.replies.filter(r => r.id !== replyId);
    yComments.set(commentId, {
        ...existing,
        replies,
        updatedAt: new Date().toISOString()
    });
};
