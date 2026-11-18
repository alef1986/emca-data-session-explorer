/**
 * Tiptap & ProseMirror editor configurations, marks, extensions, and factories
 * for EMCA Data Session Explorer.
 */

import { Editor, Mark, Extension, mergeAttributes } from 'https://esm.sh/@tiptap/core@2.2.4';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2.2.4';
import Collaboration from 'https://esm.sh/@tiptap/extension-collaboration@2.2.4?deps=yjs@13.6.18';
import CollaborationCursor from 'https://esm.sh/@tiptap/extension-collaboration-cursor@2.2.4?deps=yjs@13.6.18';
import TextAlign from 'https://esm.sh/@tiptap/extension-text-align@2.2.4';
import Underline from 'https://esm.sh/@tiptap/extension-underline@2.2.4';
import { Plugin } from 'https://esm.sh/@tiptap/pm@2.2.4/state';

export { Editor, StarterKit, Collaboration, CollaborationCursor, TextAlign, Underline, Plugin, Mark, Extension, mergeAttributes };

export const TimecodeMark = Mark.create({
    name: 'timecode',
    inclusive: true,
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
        };
    },
    parseHTML() { return [{ tag: 'span[data-start]' }]; },
    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes(HTMLAttributes, { 
            class: 'timecode-segment hover:bg-gray-100 cursor-pointer transition-colors duration-150 rounded px-0.5' 
        }), 0];
    },
});

export const CommentMark = Mark.create({
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

export const TextColorMark = Mark.create({
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


export const createReadOnlyTextLock = (options = {}) => {
    const isEditing = typeof options.isEditingEnabled === 'function' 
        ? options.isEditingEnabled 
        : () => Boolean(options.isEditingEnabled?.value ?? options.isEditingEnabled);
    const isFormatting = typeof options.isInternalFormatting === 'function'
        ? options.isInternalFormatting
        : () => Boolean(options.isInternalFormatting?.value ?? options.isInternalFormatting);

    return Extension.create({
        name: 'readOnlyTextLock',
        addProseMirrorPlugins() {
            return [
                new Plugin({
                    filterTransaction(tr, state) {
                        if (isEditing()) return true;
                        if (!tr.docChanged) return true;
                        if (tr.getMeta('y-sync$') || tr.getMeta('allow-init') || isFormatting()) return true;

                        for (const step of tr.steps) {
                            const json = step.toJSON ? step.toJSON() : {};
                            const type = json.stepType || step.constructor?.name;
                            if (type === 'addMark' || type === 'removeMark' || type === 'AddMarkStep' || type === 'RemoveMarkStep') {
                                continue;
                            }
                            if (type === 'setNodeMarkup' || type === 'attr' || type === 'setDocAttribute') {
                                continue;
                            }
                            if (type === 'replaceAround' || type === 'ReplaceAroundStep') {
                                if (step.slice && step.slice.size === 0) continue;
                            }
                            return false;
                        }
                        return true;
                    },
                    props: {
                        handleKeyDown(view, event) {
                            if (!isEditing()) {
                                if (event.ctrlKey || event.metaKey || event.altKey) {
                                    return false;
                                }
                                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Tab', 'Escape'].includes(event.key)) {
                                    return false;
                                }
                                event.preventDefault();
                                return true;
                            }
                            return false;
                        },
                        handlePaste(view, event) {
                            if (!isEditing()) {
                                event.preventDefault();
                                return true;
                            }
                            return false;
                        },
                        handleDrop(view, event) {
                            if (!isEditing()) {
                                event.preventDefault();
                                return true;
                            }
                            return false;
                        },
                        handleTextInput(view, from, to, text) {
                            if (!isEditing()) {
                                return true;
                            }
                            return false;
                        }
                    }
                })
            ];
        },
        addKeyboardShortcuts() {
            return {
                'Enter': () => this.editor.commands.splitBlock({ keepMarks: true })
            };
        }
    });
};


export const createEditor = ({
    element,
    ydoc,
    provider = null,
    sessionMode = 'local',
    userName = 'Anonymous',
    userColor = '#0ea5e9',
    isEditingEnabled = () => false,
    isInternalFormatting = () => false,
    onSelectionUpdate = null,
    onTransaction = null,
    onTimecodeClick = null,
    onCommentClick = null,
}) => {
    const extensions = [
        StarterKit.configure({ history: false }),
        Underline,
        TimecodeMark,
        CommentMark,
        TextColorMark,
        createReadOnlyTextLock({ isEditingEnabled, isInternalFormatting }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Collaboration.configure({ document: ydoc, field: 'emca-transcript' })
    ];

    if (sessionMode !== 'local' && provider) {
        const resolvedName = typeof userName === 'function' ? userName() : (userName?.value || userName || 'Anonymous');
        extensions.push(CollaborationCursor.configure({
            provider: provider,
            user: {
                name: resolvedName,
                color: userColor
            }
        }));
    }

    const editor = new Editor({
        element,
        extensions,
        editorProps: {
            attributes: {
                class: 'prose max-w-none focus:outline-none min-h-[500px] leading-relaxed p-4',
                spellcheck: 'false',
            },
        },
    });

    if (onSelectionUpdate) {
        editor.on('selectionUpdate', () => onSelectionUpdate(editor));
    }
    if (onTransaction) {
        editor.on('transaction', () => onTransaction(editor));
    }

    if (editor.view && editor.view.dom) {
        editor.view.dom.addEventListener('click', (e) => {
            const timecodeSpan = e.target.closest('[data-start]');
            if (timecodeSpan && onTimecodeClick) {
                const startTime = parseFloat(timecodeSpan.getAttribute('data-start'));
                if (!isNaN(startTime)) {
                    onTimecodeClick(startTime, editor);
                }
            }

            const commentSpan = e.target.closest('[data-comment-id]');
            if (commentSpan && onCommentClick) {
                const cId = commentSpan.getAttribute('data-comment-id');
                if (cId) {
                    onCommentClick(cId, editor);
                }
            }
        });
    }

    return editor;
};
