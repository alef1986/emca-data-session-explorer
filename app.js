import { createApp, ref, computed, watch, nextTick, onUnmounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import { dictionary, colorSwatches } from './i18n.js';
import {
    copyToClipboard, formatTime, formatCommentTime,
    createCommentAtSelection, deleteCommentMarkAndData, saveCommentText,
    addCommentReply, deleteCommentReply, mergeCommentsData
} from './js/utils.js';
import {
    parseTranscriptContent, loadTranscriptIntoEditor
} from './js/parsers.js';
import { createEditor } from './js/editor.js';
import { exportJson as exportJsonFile, exportWord as exportWordFile } from './js/exporter.js';
import {
    PUBLIC_SIGNALING_SERVERS, getPeersList, startSessionWorkflow, setupSessionMaps
} from './js/network.js';
import {
    clearSegmentHighlight, updateActiveSegmentHighlight, createSpectrogramPlugin,
    computeFrequencyLabels, getWaveScrollContainer, togglePiP as playerTogglePiP,
    createPlayer, createWaveInteraction
} from './js/player.js';
import {
    parseMergeFileInput, initMergeEditorWorkflow, rebuildMergePreview,
    filterMergeChanges, summarizeMergeChanges, createMergePreviewEditor,
    saveMergedBaseline as runSaveMergedBaseline, parseProposalFile,
    previewProposalWorkflow, rejectProposalWorkflow
} from './js/merger.js';

createApp({
    setup() {
        const locale = ref('ru');
        const t = computed(() => (key, params) => {
            let text = dictionary[locale.value]?.[key] || dictionary.ru?.[key] || key;
            if (params && typeof params === 'object') {
                Object.entries(params).forEach(([k, v]) => { text = text.replace(new RegExp(`{${k}}`, 'g'), v); });
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
        watch(userName, (val) => localStorage.setItem('emca_username', val));

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
                await copyToClipboard(text);
                isRoomCopied.value = true;
                setTimeout(() => { isRoomCopied.value = false; }, 2000);
            } catch (err) {
                console.error('Failed to copy room details:', err);
            }
        };

        const serverPreset = ref('public');
        const customServerUrl = ref('wss://');

        const isTextEditingEnabled = ref(false);
        const isBoldActive = ref(false);
        const isUnderlineActive = ref(false);
        let isInternalFormatting = false;

        const showAdvancedNetwork = ref(false);
        const useTurnServer = ref(false);
        const turnPreset = ref('openrelay');
        const customTurnUrl = ref('');
        const customTurnUsername = ref('');
        const customTurnCredential = ref('');

        const activeSignalingServers = computed(() => {
            if (serverPreset.value === 'public') return PUBLIC_SIGNALING_SERVERS;
            const custom = customServerUrl.value.split(',').map(s => s.trim()).filter(Boolean);
            return custom.length > 0 ? custom : ['wss://signaling.yjs.dev'];
        });

        const mergeFiles = ref([]);
        const isMergeDragging = ref(false);
        const isMergeModeActive = ref(false);
        const mergeChanges = ref([]);
        const mergeFilter = ref('all');
        const mergeSearchQuery = ref('');
        const mergePreviewRef = ref(null);
        let mergeEditorInstance = null;
        let mergeBaselineYDoc = null;
        let mergeBaseParagraphs = null;

        const isDraggingAudio = ref(false);
        const isDraggingJson = ref(false);
        const localJsonBuffer = ref(null);
        const isTextSelected = ref(false);
        const showHighlightPicker = ref(false);
        const highlightColors = [
            { name: 'red', hex: '#dc2626' }, { name: 'green', hex: '#16a34a' },
            { name: 'blue', hex: '#2563eb' }, { name: 'purple', hex: '#9333ea' },
            { name: 'pink', hex: '#db2777' }, { name: 'orange', hex: '#ea580c' },
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
        const isVideoMode = ref(false);
        const showVideo = ref(true);
        const videoRef = ref(null);
        const videoZoom = ref(1);
        const videoPan = ref({ x: 0, y: 0 });
        const isPanningVideo = ref(false);
        const editorRef = ref(null);
        const autoScroll = ref(true);
        const currentAlignment = ref('left');
        const highlightActiveSegment = ref(localStorage.getItem('emca_highlight_segment') === 'true');
        const seekOnClick = ref(localStorage.getItem('emca_seek_on_click') !== 'false');
        watch(seekOnClick, (val) => localStorage.setItem('emca_seek_on_click', val));
        const anonymizeSpeakers = ref(localStorage.getItem('emca_anonymize_speakers') === 'true');
        watch(anonymizeSpeakers, (val) => localStorage.setItem('emca_anonymize_speakers', val));

        let ws = null;
        let activeSpectrogramPlugin = null;
        let regionsPlugin = null;
        let activeLoopRegion = null;
        let disableDragSelectionFn = null;
        let zoomRedrawTimer = null;
        let editor = null;
        let currentActiveSegmentRange = null;

        const clearHighlightActiveSegment = () => {
            if (editorRef.value) clearSegmentHighlight(editorRef.value);
            currentActiveSegmentRange = null;
        };

        const updateSegmentHighlight = (time) => {
            if (!highlightActiveSegment.value) {
                if (currentActiveSegmentRange !== null) clearHighlightActiveSegment();
                return;
            }
            if (!editorRef.value) return;
            currentActiveSegmentRange = updateActiveSegmentHighlight(editorRef.value, time, currentActiveSegmentRange);
        };

        watch(highlightActiveSegment, (newVal) => {
            localStorage.setItem('emca_highlight_segment', newVal);
            if (newVal) updateSegmentHighlight(currentTime.value);
            else clearHighlightActiveSegment();
        });

        const isReadyToStart = computed(() => {
            if (!sessionMode.value) return false;
            if (sessionMode.value === 'local') return Boolean(audioUrl.value);
            if (sessionMode.value === 'host' || sessionMode.value === 'join') {
                const hasServer = serverPreset.value === 'public' || (customServerUrl.value && customServerUrl.value.length > 6);
                return Boolean(audioUrl.value && roomName.value.trim() && userName.value.trim() && hasServer);
            }
            return false;
        });

        const setMode = (mode) => {
            sessionMode.value = mode;
            connectionErrorMsg.value = '';
            highlightErrors.value = false;
        };

        const freqLabels = computed(() => computeFrequencyLabels(freqMin.value, freqMax.value));


        const processAudioFile = (file) => {
            if (file) {
                isVideoMode.value = file.type.startsWith('video/');
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
                        const result = parseTranscriptContent(rawContent, file.name, {
                            anonymize: anonymizeSpeakers.value,
                            speakerPrefix: t.value('speaker_prefix')
                        });
                        jsonFileName.value = file.name;
                        if (isSessionStarted.value && ydoc) loadInitialTranscript(result);
                        else localJsonBuffer.value = result;
                    } catch (err) {
                        console.error('Error reading transcript file:', err);
                        alert('Error reading transcript file.');
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
                    alert('Please drop a .json, .vtt, or .srt format file.');
                }
            }
        };

        const updatePeersList = () => {
            const { count, list } = getPeersList(provider, ydoc);
            connectedPeers.value = count;
            peersList.value = list;
            connectionState.value = connectedPeers.value > 1 ? 'connected' : 'waiting';
            if (connectedPeers.value > 1) syncError.value = false;
        };

        const initRichTextEditor = () => {
            if (editor) editor.destroy();
            const coloredSwatches = colorSwatches.filter(s => s.hex && s.key);
            const randomColor = coloredSwatches.length > 0
                ? coloredSwatches[Math.floor(Math.random() * coloredSwatches.length)].hex
                : (colorSwatches[0]?.hex || '#0ea5e9');

            const checkSelection = () => {
                if (!editor) { isTextSelected.value = false; return; }
                const { from, to, empty } = editor.state.selection;
                isTextSelected.value = !empty && (to - from > 0);
            };

            const updateFormattingState = () => {
                currentAlignment.value = editor.isActive({ textAlign: 'justify' }) ? 'justify' : 'left';
                isBoldActive.value = editor.isActive('bold');
                isUnderlineActive.value = editor.isActive('underline');
                checkSelection();
            };

            editor = createEditor({
                element: editorRef.value,
                ydoc,
                provider,
                sessionMode: sessionMode.value,
                userName,
                userColor: randomColor,
                isEditingEnabled: () => isTextEditingEnabled.value,
                isInternalFormatting: () => isInternalFormatting,
                onSelectionUpdate: () => updateFormattingState(),
                onTransaction: () => {
                    updateFormattingState();
                    if (highlightActiveSegment.value) updateSegmentHighlight(currentTime.value);
                },
                onTimecodeClick: (startTime) => {
                    if (seekOnClick.value && editor.state.selection.empty) jumpTo(startTime);
                },
                onCommentClick: (commentId) => selectComment(commentId)
            });
        };

        const loadInitialTranscript = (jsonBuffer) => {
            return loadTranscriptIntoEditor({
                editor,
                ydoc,
                yMeta,
                yComments,
                jsonBuffer,
                anonymize: anonymizeSpeakers.value,
                speakerPrefix: t.value('speaker_prefix'),
                setInternalFormatting: (val) => { isInternalFormatting = val; }
            });
        };


        const startSession = async () => {
            if (!isReadyToStart.value) { highlightErrors.value = true; return; }
            connectionErrorMsg.value = '';
            isConnectingP2P.value = true;

            try {
                const sessionRes = await startSessionWorkflow({
                    sessionMode: sessionMode.value,
                    roomName: roomName.value,
                    roomPassword: roomPassword.value,
                    serverPreset: serverPreset.value,
                    customServerUrl: customServerUrl.value,
                    activeSignalingServers: activeSignalingServers.value,
                    useTurnServer: useTurnServer.value,
                    turnPreset: turnPreset.value,
                    customTurnUrl: customTurnUrl.value,
                    customTurnUsername: customTurnUsername.value,
                    customTurnCredential: customTurnCredential.value,
                    userName: userName.value,
                    userColor: '#0ea5e9',
                    localJsonBuffer: localJsonBuffer.value,
                    onStatus: ({ status }) => {
                        if (status === 'connected') {
                            syncError.value = false;
                            connectionState.value = connectedPeers.value > 1 ? 'connected' : 'waiting';
                        } else if (status === 'disconnected') {
                            connectionState.value = 'disconnected';
                        }
                    },
                    onPeers: () => updatePeersList(),
                    onAwarenessChange: () => updatePeersList()
                });

                ydoc = sessionRes.ydoc;
                provider = sessionRes.provider;
                idbProvider = sessionRes.idbProvider;

                isConnectingP2P.value = false;
                if (provider) {
                    updatePeersList();
                    connectionState.value = 'waiting';
                }

                let isSyncedHandled = false;
                const handleSynced = async () => {
                    if (isSyncedHandled) return;
                    isSyncedHandled = true;

                    try {
                        const maps = setupSessionMaps({
                            ydoc,
                            onCommentsChange: () => updateCommentsFromYjs(),
                            onProposalsChange: () => {
                                const act = yProposals.get('active');
                                activeProposal.value = act || null;
                                if (!act && baselineSnapshot.value) baselineSnapshot.value = null;
                            }
                        });
                        yComments = maps.yComments;
                        yMeta = maps.yMeta;
                        yProposals = maps.yProposals;

                        baselineSnapshot.value = null;
                        activeProposal.value = yProposals.get('active') || null;
                        updateCommentsFromYjs();

                        isSessionStarted.value = true;
                        await nextTick();
                        await initPlayer();
                        initRichTextEditor();

                        if (localJsonBuffer.value) {
                            if (localJsonBuffer.value._yjs_state) {
                                if (yMeta && !yMeta.get('transcriptId')) {
                                    yMeta.set('transcriptId', localJsonBuffer.value.transcriptId || ('tr_' + Date.now()));
                                }
                                if (yComments && yComments.size === 0 && Array.isArray(localJsonBuffer.value.comments)) {
                                    mergeCommentsData(yComments, localJsonBuffer.value.comments);
                                }
                                localJsonBuffer.value = null;
                            } else {
                                const transcriptFrag = ydoc.getXmlFragment('emca-transcript');
                                let shouldLoadNew = true;
                                if (transcriptFrag.length > 0) {
                                    shouldLoadNew = window.confirm(t.value('confirm_overwrite_autosave'));
                                    if (shouldLoadNew) {
                                        ydoc.transact(() => { transcriptFrag.delete(0, transcriptFrag.length); });
                                    }
                                }
                                if (shouldLoadNew) loadInitialTranscript(localJsonBuffer.value);
                                localJsonBuffer.value = null;
                            }
                        }

                        initSpectrogram();
                    } catch (err) {
                        console.error('Initialization error:', err);
                    }
                };

                idbProvider.on('synced', handleSynced);
                setTimeout(() => { if (!isSyncedHandled) handleSynced(); }, 1500);

            } catch (err) {
                console.error('Failed to start session:', err);
                isConnectingP2P.value = false;
                connectionState.value = 'error';
                connectionErrorMsg.value = err.message || 'Не удалось подключиться к сигнальному серверу.';
            }
        };


        const updateCommentsFromYjs = () => {
            if (!yComments) return;
            const arr = [];
            yComments.forEach((val, key) => { if (val) arr.push({ ...val, id: key }); });
            arr.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
            commentsList.value = arr;
        };

        const toggleHighlightPicker = () => {
            if (isTextSelected.value) showHighlightPicker.value = !showHighlightPicker.value;
        };
        const applyHighlight = (colorHex) => {
            if (editor) editor.chain().focus().setMark('textColor', { color: colorHex }).run();
            showHighlightPicker.value = false;
        };
        const clearHighlight = () => {
            if (editor) editor.chain().focus().unsetMark('textColor').run();
            showHighlightPicker.value = false;
        };

        const addCommentAtSelection = () => {
            const newComment = createCommentAtSelection({ editor, userName: userName.value, yComments });
            if (!newComment) return;
            activeCommentId.value = newComment.id;
            editingCommentId.value = newComment.id;
            editingCommentText.value = '';
            nextTick(() => {
                const card = document.getElementById('comment-card-' + newComment.id);
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
                if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
        };

        const jumpToCommentInEditor = (commentId) => {
            activeCommentId.value = commentId;
            if (!editorRef.value) return;
            const markEl = editorRef.value.querySelector(`[data-comment-id="${commentId}"]`);
            if (markEl) {
                markEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                markEl.classList.add('emca-comment-pulse');
                setTimeout(() => { markEl.classList.remove('emca-comment-pulse'); }, 1800);
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
            saveCommentText({ yComments, commentId, text: editingCommentText.value, onDelete: deleteComment });
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
            deleteCommentMarkAndData({ editor, yComments, commentId });
            if (activeCommentId.value === commentId) activeCommentId.value = null;
            if (editingCommentId.value === commentId) {
                editingCommentId.value = null;
                editingCommentText.value = '';
            }
        };

        const addReply = (commentId) => {
            addCommentReply({ yComments, commentId, author: userName.value, text: replyInputText.value[commentId] });
            replyInputText.value[commentId] = '';
        };

        const deleteReply = (commentId, replyId) => {
            deleteCommentReply({ yComments, commentId, replyId });
        };

        // --- Export Handlers ---
        const exportJson = () => {
            return exportJsonFile({
                ydoc,
                yMeta,
                audioFileName: audioFileName.value,
                comments: commentsList.value
            });
        };

        const exportWord = () => {
            return exportWordFile({
                editor,
                comments: commentsList.value,
                audioFileName: audioFileName.value
            });
        };

        // --- Proposals Handlers ---
        const handleProposalFileChange = async (event) => {
            const file = event.target?.files?.[0];
            if (!file) return;
            try {
                const currentTranscriptId = yMeta ? yMeta.get('transcriptId') : null;
                const proposal = await parseProposalFile(file, {
                    currentTranscriptId,
                    userName: userName.value,
                    t: t.value
                });
                if (yProposals) {
                    yProposals.set('active', proposal);
                    alert(t.value('proposal_sent_notice'));
                }
            } catch (err) {
                console.error('Failed to parse proposal json:', err);
                alert(err.message || t.value('error_v2_required'));
            } finally {
                event.target.value = '';
            }
        };

        const previewProposal = async () => {
            if (!editor || !ydoc || !yProposals) return;
            const proposal = yProposals.get('active');
            if (!proposal || !proposal.yjsState) return;

            const snapshot = await previewProposalWorkflow({
                editor,
                ydoc,
                yComments,
                proposal,
                commentsList: commentsList.value
            });

            if (snapshot) {
                baselineSnapshot.value = snapshot;
                yProposals.set('active', {
                    ...proposal,
                    status: 'previewing'
                });
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
                rejectProposalWorkflow({
                    editor,
                    ydoc,
                    yComments,
                    baselineSnapshot: baselineSnapshot.value,
                    setFormattingFlag: (val) => { isInternalFormatting = val; }
                });
                updateCommentsFromYjs();
                baselineSnapshot.value = null;
            }
            if (yProposals) {
                yProposals.delete('active');
            }
        };

        // --- Editor Formatting Handlers ---
        const setAlignment = (align) => {
            if (!editor) return;
            isInternalFormatting = true;
            try {
                const { from, to } = editor.state.selection;
                if (from === to) {
                    editor.chain().focus().selectAll().setTextAlign(align).setTextSelection(from).run();
                } else {
                    editor.chain().focus().setTextAlign(align).run();
                }
                currentAlignment.value = align;
            } finally {
                isInternalFormatting = false;
            }
        };

        const toggleBold = () => {
            if (editor) editor.chain().focus().toggleBold().run();
        };

        const toggleUnderline = () => {
            if (editor) editor.chain().focus().toggleUnderline().run();
        };

        const toggleTextEditing = () => {
            if (!isTextEditingEnabled.value) {
                const ok = window.confirm(t.value('confirm_enable_text_edit'));
                if (ok) {
                    isTextEditingEnabled.value = true;
                }
            } else {
                isTextEditingEnabled.value = false;
            }
        };


        // --- Player, Spectrogram, Loop & Video Handlers ---
        const isLoopMode = ref(false);
        const hasActiveLoop = ref(false);
        const isDraggingWave = ref(false);
        let loopTimeout = null;

        const initSpectrogram = () => {
            if (!ws) return;
            if (activeSpectrogramPlugin) {
                try { activeSpectrogramPlugin.destroy(); } catch (e) {}
            }
            activeSpectrogramPlugin = createSpectrogramPlugin({
                freqMin: freqMin.value,
                freqMax: freqMax.value
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

        const initPlayer = async () => {
            await nextTick();
            if (isVideoMode.value && videoRef.value) {
                videoRef.value.src = audioUrl.value;
            }
            const playerObj = createPlayer({
                container: waveformRef.value,
                media: isVideoMode.value ? videoRef.value : null,
                audioUrl: audioUrl.value,
                autoCenter: autoScroll.value,
                isVideo: isVideoMode.value,
                onReady: () => { isAudioReady.value = true; },
                onPlay: () => { isPlaying.value = true; },
                onPause: () => { isPlaying.value = false; },
                onTimeUpdate: (time) => { currentTime.value = time; },
                onRegionCreated: (region) => {
                    if (activeLoopRegion && activeLoopRegion !== region) activeLoopRegion.remove();
                    activeLoopRegion = region;
                    hasActiveLoop.value = true;
                },
                onRegionUpdated: () => { clearTimeout(loopTimeout); }
            });
            ws = playerObj.ws;
            regionsPlugin = playerObj.regionsPlugin;

            ws.on('seeking', (time) => {
                currentTime.value = time;
                if (highlightActiveSegment.value) {
                    updateSegmentHighlight(time);
                }
            });

            initSpectrogram();
        };

        const waveInteraction = createWaveInteraction({
            getWs: () => ws,
            getIsAudioReady: () => isAudioReady.value,
            getIsLoopMode: () => isLoopMode.value,
            getScrollContainer: () => getWaveScrollContainer(ws),
            onTimeChange: (newTime) => { currentTime.value = newTime; },
            onSegmentHighlight: (newTime) => {
                if (highlightActiveSegment.value) updateSegmentHighlight(newTime);
            },
            onDraggingChange: (val) => { isDraggingWave.value = val; },
            zoomIn: () => zoomIn(),
            zoomOut: () => zoomOut()
        });

        const onWaveWheel = waveInteraction.onWaveWheel;
        const onWavePointerDown = waveInteraction.onWavePointerDown;
        const onWavePointerMove = waveInteraction.onWavePointerMove;
        const onWavePointerUp = waveInteraction.onWavePointerUp;

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
                    updateSegmentHighlight(time);
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


        const togglePiP = () => playerTogglePiP(videoRef.value);

        const onVideoPointerDown = (e) => {
            if (Number(videoZoom.value) > 1) {
                isPanningVideo.value = true;
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
            }
        };

        const onVideoPointerMove = (e) => {
            if (isPanningVideo.value && Number(videoZoom.value) > 1) {
                videoPan.value = {
                    x: videoPan.value.x + (e.movementX || 0),
                    y: videoPan.value.y + (e.movementY || 0)
                };
            }
        };

        const onVideoPointerUp = (e) => {
            if (isPanningVideo.value) {
                isPanningVideo.value = false;
                try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
            }
        };

        const resetVideoZoom = () => {
            videoZoom.value = 1;
            videoPan.value = { x: 0, y: 0 };
        };

        watch(videoZoom, (newZoom) => {
            if (Number(newZoom) <= 1) {
                videoPan.value = { x: 0, y: 0 };
            }
        });

        watch(autoScroll, (newVal) => { if (ws) ws.setOptions({ autoCenter: newVal }); });

        watch(currentTime, async (newTime) => {
            if (highlightActiveSegment.value) {
                updateSegmentHighlight(newTime);
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

        // --- Popups Handlers ---
        const togglePeersList = () => { showPeersList.value = !showPeersList.value; };
        const closePopups = () => {
            showPeersList.value = false;
            showHighlightPicker.value = false;
        };


        // --- Offline Merge Workspace Handlers ---
        const processMergeFiles = async (files) => {
            for (const file of files) {
                try {
                    const item = await parseMergeFileInput(file, mergeFiles.value, t.value);
                    if (item) mergeFiles.value.push(item);
                } catch (err) {
                    console.error('Error reading merge file:', err);
                    alert(err.message);
                }
            }
        };

        const handleMergeFilesSelect = async (event) => {
            const files = Array.from(event.target?.files || []);
            if (files.length === 0) return;
            await processMergeFiles(files);
            event.target.value = '';
        };

        const handleMergeFilesDrop = async (event) => {
            isMergeDragging.value = false;
            const files = Array.from(event.dataTransfer?.files || []);
            if (files.length === 0) return;
            await processMergeFiles(files);
        };

        const moveMergeFile = (index, direction) => {
            const target = index + direction;
            if (target < 0 || target >= mergeFiles.value.length) return;
            const item = mergeFiles.value.splice(index, 1)[0];
            mergeFiles.value.splice(target, 0, item);
        };

        const removeMergeFile = (index) => {
            mergeFiles.value.splice(index, 1);
        };

        const triggerRebuildMergePreview = () => {
            rebuildMergePreview({
                mergeEditorInstance,
                mergeBaseParagraphs,
                mergeChanges: mergeChanges.value
            });
        };

        const acceptChange = (changeId) => {
            const change = mergeChanges.value.find(c => c.id === changeId);
            if (!change) return;
            change.status = 'accepted';
            triggerRebuildMergePreview();
        };

        const rejectChange = (changeId) => {
            const change = mergeChanges.value.find(c => c.id === changeId);
            if (!change) return;
            change.status = 'rejected';
            triggerRebuildMergePreview();
        };

        const acceptAllChanges = () => {
            mergeChanges.value.forEach(c => { c.status = 'accepted'; });
            triggerRebuildMergePreview();
        };

        const rejectAllChanges = () => {
            mergeChanges.value.forEach(c => { c.status = 'rejected'; });
            triggerRebuildMergePreview();
        };

        const openMergeEditor = async () => {
            if (mergeFiles.value.length < 2) {
                alert(t.value('merge_need_min_files'));
                return;
            }
            try {
                const res = await initMergeEditorWorkflow({
                    mergeFiles: mergeFiles.value,
                    previewElement: null,
                    t: t.value
                });
                mergeChanges.value = res.changes;
                mergeBaseParagraphs = res.baseParagraphs;
                mergeBaselineYDoc = res.baselineYDoc;
                isMergeModeActive.value = true;

                await nextTick();
                if (mergePreviewRef.value) {
                    if (mergeEditorInstance) mergeEditorInstance.destroy();
                    mergeEditorInstance = createMergePreviewEditor({
                        element: mergePreviewRef.value,
                        content: mergeBaseParagraphs
                    });
                }
            } catch (err) {
                console.error('Failed to open merge editor:', err);
                alert(err.message);
            }
        };

        const exitMergeMode = () => {
            if (mergeEditorInstance) {
                try { mergeEditorInstance.destroy(); } catch (_) {}
                mergeEditorInstance = null;
            }
            if (mergeBaselineYDoc) {
                try { mergeBaselineYDoc.destroy(); } catch (_) {}
                mergeBaselineYDoc = null;
            }
            isMergeModeActive.value = false;
            sessionMode.value = null;
            mergeFiles.value = [];
            mergeChanges.value = [];
            mergeBaseParagraphs = null;
        };

        const backToMergeFiles = () => {
            if (mergeEditorInstance) {
                try { mergeEditorInstance.destroy(); } catch (_) {}
                mergeEditorInstance = null;
            }
            isMergeModeActive.value = false;
        };

        const saveMergedBaseline = async () => {
            if (mergeFiles.value.length === 0) return;
            try {
                await runSaveMergedBaseline({
                    mergeFiles: mergeFiles.value,
                    mergeChanges: mergeChanges.value,
                    mergeBaseParagraphs
                });
            } catch (err) {
                console.error('Error saving merged baseline:', err);
                alert(err.message || 'Failed to save merged baseline');
            }
        };

        const filteredMergeChanges = computed(() => {
            return filterMergeChanges(mergeChanges.value, mergeFilter.value, mergeSearchQuery.value);
        });

        const mergeChangesSummary = computed(() => {
            return summarizeMergeChanges(mergeChanges.value);
        });


        // --- Lifecycle Cleanup ---
        onUnmounted(() => {
            clearTimeout(loopTimeout);
            clearTimeout(zoomRedrawTimer);
            if (editor) editor.destroy();
            if (activeSpectrogramPlugin) {
                try { activeSpectrogramPlugin.destroy(); } catch (_) {}
            }
            if (mergeEditorInstance) mergeEditorInstance.destroy();
            if (ws) ws.destroy();
            if (provider) provider.destroy();
            if (idbProvider) idbProvider.destroy();
            if (ydoc) ydoc.destroy();
            if (mergeBaselineYDoc) mergeBaselineYDoc.destroy();
            if (audioUrl.value) URL.revokeObjectURL(audioUrl.value);
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
            setAlignment, currentAlignment, highlightActiveSegment, seekOnClick, anonymizeSpeakers,
            isTextSelected, showHighlightPicker, toggleHighlightPicker, highlightColors, clearHighlight,
            commentsList, activeCommentId, selectComment, jumpToCommentInEditor, startEditComment, saveCommentEdit,
            cancelCommentEdit, deleteComment, editingCommentId, editingCommentText, replyInputText, addReply, deleteReply,
            addCommentAtSelection, formatCommentTime, exportJson, exportWord,
            activeProposal, baselineSnapshot, isCommentNew, isReplyNew, proposalFileInput, handleProposalFileChange,
            previewProposal, acceptProposal, rejectProposal,
            isVideoMode, showVideo, videoRef, videoZoom, videoPan, isPanningVideo,
            togglePiP, onVideoPointerDown, onVideoPointerMove, onVideoPointerUp, resetVideoZoom,
            isTextEditingEnabled, toggleTextEditing, toggleBold, toggleUnderline, isBoldActive, isUnderlineActive,
            showAdvancedNetwork, useTurnServer, turnPreset, customTurnUrl, customTurnUsername, customTurnCredential,
            mergeFiles, isMergeDragging, isMergeModeActive, mergeChanges, mergeFilter, mergePreviewRef, mergeSearchQuery,
            handleMergeFilesSelect, handleMergeFilesDrop, moveMergeFile, removeMergeFile, openMergeEditor,
            acceptChange, rejectChange, acceptAllChanges, rejectAllChanges, exitMergeMode, backToMergeFiles,
            saveMergedBaseline, filteredMergeChanges, mergeChangesSummary
        };
    }
}).mount('#app');

