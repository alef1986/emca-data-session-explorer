import { createApp, ref, computed, watch, nextTick, onUnmounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js';
import Spectrogram from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/spectrogram.esm.js';
import RegionsPlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/regions.esm.js';
import { dictionary, colorSwatches } from './i18n.js';

import { Editor, Mark, mergeAttributes } from 'https://esm.sh/@tiptap/core@2.2.4';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2.2.4';
import Collaboration from 'https://esm.sh/@tiptap/extension-collaboration@2.2.4?deps=yjs@13.6.18';
import CollaborationCursor from 'https://esm.sh/@tiptap/extension-collaboration-cursor@2.2.4?deps=yjs@13.6.18';
import Highlight from 'https://esm.sh/@tiptap/extension-highlight@2.2.4';
import TextAlign from 'https://esm.sh/@tiptap/extension-text-align@2.2.4';

createApp({
    setup() {
        const locale = ref('ru');
        const t = computed(() => (key) => dictionary[locale.value][key] || key);
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
        
        const serverPreset = ref('public');
        const customServerUrl = ref('wss://');
        
        const isDraggingAudio = ref(false);
        const isDraggingJson = ref(false);
        const localJsonBuffer = ref(null); 

        // Подсветка текста и комментарии
        const isTextSelected = ref(false);
        const showHighlightPicker = ref(false);
        const highlightColors = [
            { name: 'yellow', hex: '#fef08a' },
            { name: 'green', hex: '#86efac' },
            { name: 'blue', hex: '#93c5fd' },
            { name: 'purple', hex: '#d8b4fe' },
            { name: 'pink', hex: '#f472b6' },
            { name: 'orange', hex: '#fdba74' },
            { name: 'teal', hex: '#5eead4' }
        ];
        const activeCommentId = ref(null);
        const editingCommentId = ref(null);
        const editingCommentText = ref('');
        const replyInputText = ref({});
        const commentsList = ref([]);
        let yComments = null;

        let ydoc = null;
        let provider = null;
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
                        const parsed = JSON.parse(e.target.result);
                        jsonFileName.value = file.name;
                        if (isSessionStarted.value && ydoc) {
                            loadInitialTranscript(parsed);
                        } else {
                            localJsonBuffer.value = parsed;
                        }
                    } catch (err) {
                        alert("Error reading JSON file.");
                    }
                };
                reader.readAsText(file);
            }
        };
        const handleStartJson = (event) => processJsonFile(event.target.files[0]);
        const handleJsonDrop = (event) => {
            isDraggingJson.value = false;
            const file = event.dataTransfer.files[0];
            if (file && file.name.endsWith('.json')) {
                processJsonFile(file);
            } else if (file) {
                alert("Please drop a .json format file.");
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
                Highlight.configure({ multicolor: true }),
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

        const escapeHtml = (str) => {
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };

        const formatTranscriptToHtml = (jsonBuffer, pauseThreshold = 1.0) => {
            if (!Array.isArray(jsonBuffer)) return '';
            const validLines = jsonBuffer.filter(line => line && typeof line.text === 'string' && line.text.trim().length > 0);
            if (validLines.length === 0) return '';

            const paragraphs = [];
            let currentParagraphSpans = [];
            let prevEnd = null;

            for (const line of validLines) {
                const start = parseFloat(line.start);
                const end = parseFloat(line.end);
                const safeStart = !isNaN(start) ? start : 0;
                const safeEnd = !isNaN(end) ? end : safeStart;
                const cleanText = escapeHtml(line.text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim());
                if (!cleanText) continue;

                // Если пауза между концом предыдущего сегмента и началом текущего больше 1 секунды - создаем новый абзац
                if (prevEnd !== null && (safeStart - prevEnd) > pauseThreshold) {
                    if (currentParagraphSpans.length > 0) {
                        paragraphs.push(currentParagraphSpans.join(' '));
                        currentParagraphSpans = [];
                    }
                }

                currentParagraphSpans.push(`<span data-start="${safeStart}" data-end="${safeEnd}">${cleanText}</span>`);
                prevEnd = safeEnd;
            }

            if (currentParagraphSpans.length > 0) {
                paragraphs.push(currentParagraphSpans.join(' '));
            }

            return paragraphs.map(p => `<p>${p}</p>`).join('');
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
                const yjsModule = await import('https://esm.sh/yjs@13.6.18');
                const Y = yjsModule.default || yjsModule;
                ydoc = new Y.Doc();
                yComments = ydoc.getMap('emca-comments');
                yComments.observeDeep(() => {
                    updateCommentsFromYjs();
                });
                updateCommentsFromYjs();

                if (sessionMode.value === 'local') {
                    isSessionStarted.value = true;
                    nextTick(() => { 
                        initPlayer(); 
                        initRichTextEditor();
                        if (localJsonBuffer.value) {
                            loadInitialTranscript(localJsonBuffer.value);
                            localJsonBuffer.value = null;
                        }
                    });
                } else {
                    isConnectingP2P.value = true;
                    await checkServerConnection(activeSignalingServer.value);
                    const webrtcModule = await import('https://esm.sh/y-webrtc@10.3.0?deps=yjs@13.6.18');
                    const WebrtcProvider = webrtcModule.WebrtcProvider;

                    const providerOpts = { 
                        signaling: [activeSignalingServer.value],
                        peerOpts: { config: { iceServers: [ { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' } ] } }
                    };
                    if (roomPassword.value.trim() !== '') providerOpts.password = roomPassword.value.trim();

                    provider = new WebrtcProvider('emca-p2p-' + roomName.value.trim(), ydoc, providerOpts);
                    provider.awareness.setLocalStateField('user', { name: userName.value.trim() || 'User ' + Math.floor(Math.random() * 1000) });
                    provider.awareness.on('change', updatePeersList);
                    updatePeersList();

                    isConnectingP2P.value = false;
                    connectionState.value = 'waiting';
                    isSessionStarted.value = true;
                    
                    nextTick(() => { 
                        initPlayer(); 
                        initRichTextEditor();
                        if (sessionMode.value === 'host' && localJsonBuffer.value) {
                            loadInitialTranscript(localJsonBuffer.value);
                            localJsonBuffer.value = null; 
                        }
                    });
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
            if (editor) editor.chain().focus().toggleHighlight({ color: colorHex }).run();
            showHighlightPicker.value = false;
        };

        const clearHighlight = () => {
            if (editor) editor.chain().focus().unsetHighlight().run();
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
            addCommentAtSelection, formatCommentTime, exportJson
        };
    }
}).mount('#app');