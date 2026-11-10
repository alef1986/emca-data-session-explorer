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

        // Заглушки для сохранения работоспособности старых элементов UI (до их рефакторинга)
        const bookmarkedLines = computed(() => []);
        const searchQuery = ref('');
        const searchResults = ref([]);
        const currentSearchIndex = ref(0);
        const hasSearched = ref(false);
        const activeLineId = ref(null);

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
        
        let ws = null;
        let activeSpectrogramPlugin = null;
        let regionsPlugin = null;
        let activeLoopRegion = null;
        let disableDragSelectionFn = null;
        let zoomRedrawTimer = null;
        let editor = null;
        let yText = null;

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
                        localJsonBuffer.value = JSON.parse(e.target.result);
                        jsonFileName.value = file.name;
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

        const initRichTextEditor = () => {
            yText = ydoc.getText('emca-transcript');
            
            const extensions = [
                StarterKit,
                TimecodeMark,
                Highlight.configure({ multicolor: true }),
                TextAlign.configure({
                    types: ['heading', 'paragraph'],
                    alignments: ['left', 'justify'],
                    defaultAlignment: 'left',
                }),
            ];

            if (sessionMode.value !== 'local') {
                extensions.push(Collaboration.configure({ document: ydoc, field: 'emca-transcript' }));
                extensions.push(CollaborationCursor.configure({
                    provider: provider,
                    user: {
                        name: userName.value,
                        color: colorSwatches[Math.floor(Math.random() * colorSwatches.length)].barClass.replace('bg-', '')
                    }
                }));
            }

            editor = new Editor({
                element: editorRef.value,
                extensions: extensions,
                editorProps: {
                    attributes: { class: 'prose max-w-none focus:outline-none min-h-[500px] leading-relaxed p-4' },
                },
            });

            editor.on('selectionUpdate', () => {
                currentAlignment.value = editor.isActive({ textAlign: 'justify' }) ? 'justify' : 'left';
            });
            editor.on('transaction', () => {
                currentAlignment.value = editor.isActive({ textAlign: 'justify' }) ? 'justify' : 'left';
            });

            editor.view.dom.addEventListener('click', (e) => {
                const timecodeSpan = e.target.closest('[data-start]');
                if (timecodeSpan) {
                    const startTime = parseFloat(timecodeSpan.getAttribute('data-start'));
                    if (!isNaN(startTime)) jumpTo(startTime);
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

        const loadInitialTranscript = (jsonBuffer) => {
            if (!editor) return;
            const htmlContent = formatTranscriptToHtml(jsonBuffer, 1.0);
            editor.commands.setContent(htmlContent);
        };

        const startSession = async () => {
            highlightErrors.value = true;
            if (!isReadyToStart.value) return;
            connectionErrorMsg.value = '';

            try {
                const yjsModule = await import('https://esm.sh/yjs@13.6.18');
                const Y = yjsModule.default || yjsModule;
                ydoc = new Y.Doc();

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

        const applyHighlight = (colorHex) => {
            if (editor) editor.chain().focus().toggleHighlight({ color: colorHex }).run();
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
                        ws.setTime(targetRatio * ws.getDuration());
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
        const closePopups = () => { showPeersList.value = false; };
        const formatTime = (seconds) => {
            const m = Math.floor(seconds / 60).toString().padStart(2, '0');
            const s = Math.floor(seconds % 60).toString().padStart(2, '0');
            const ms = Math.floor((seconds % 1) * 10).toString();
            return `${m}:${s}.${ms}`;
        };

        const executeSearch = () => { hasSearched.value = true; };
        const nextSearch = () => {};
        const prevSearch = () => {};
        const exportBookmarks = () => {};

        watch(autoScroll, (newVal) => { if (ws) ws.setOptions({ autoCenter: newVal }); });

        watch(currentTime, async (newTime) => {
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
            applyFrequencyRange, waveformRef, autoScroll, activeLineId, bookmarkedLines, searchQuery, searchResults,
            currentSearchIndex, hasSearched, isLoopMode, hasActiveLoop, isDraggingWave, onWaveWheel, onWavePointerDown,
            onWavePointerMove, onWavePointerUp, togglePlay, onZoom, jumpTo, toggleLoopMode, colorSwatches, closePopups,
            formatTime, executeSearch, nextSearch, prevSearch, exportBookmarks, localJsonBuffer, editorRef, applyHighlight,
            setAlignment, currentAlignment
        };
    }
}).mount('#app');