import { createApp, ref, computed, watch, nextTick, onUnmounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js';
import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js';
import Spectrogram from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/spectrogram.esm.js';
import RegionsPlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/regions.esm.js';
import { dictionary, colorSwatches } from './i18n.js';

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

        let ydoc = null;
        let provider = null;
        let yTranscript = null;
        const connectedPeers = ref(1);
        const peersList = ref([]);
        const showPeersList = ref(false);

        const transcript = ref([]);
        const localJsonBuffer = ref(null); 

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
        const transcriptContainer = ref(null);
        const autoScroll = ref(true);
        
        let ws = null;
        let activeSpectrogramPlugin = null;
        let regionsPlugin = null;
        let activeLoopRegion = null;
        let disableDragSelectionFn = null;
        let zoomRedrawTimer = null;

        const isDraggingWave = ref(false);
        let pointerStartX = 0;
        let initialScrollLeft = 0;
        let wasDragged = false;

        const searchQuery = ref('');
        const searchResults = ref([]);
        const currentSearchIndex = ref(0);
        const hasSearched = ref(false);

        const isLoopMode = ref(false);
        const hasActiveLoop = ref(false);
        let loopTimeout = null;

        const openPickerId = ref(null);

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
                        const data = JSON.parse(e.target.result);
                        localJsonBuffer.value = data.map(line => ({
                            ...line,
                            note: line.note || '',
                            color: line.color || ''
                        }));
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

        const initP2P = async () => {
            try {
                const yjsModule = await import('https://esm.sh/yjs@13.6.18');
                const webrtcModule = await import('https://esm.sh/y-webrtc@10.3.0?deps=yjs@13.6.18');
                
                const Y = yjsModule.default || yjsModule;
                const WebrtcProvider = webrtcModule.WebrtcProvider;

                ydoc = new Y.Doc();
                
                const providerOpts = { 
                    signaling: [activeSignalingServer.value],
                    peerOpts: {
                        config: {
                            iceServers: [
                                { urls: 'stun:stun.l.google.com:19302' },
                                { urls: 'stun:stun1.l.google.com:19302' },
                                { urls: 'stun:stun.cloudflare.com:3478' }
                            ]
                        }
                    }
                };
                if (roomPassword.value.trim() !== '') {
                    providerOpts.password = roomPassword.value.trim();
                }

                provider = new WebrtcProvider('emca-p2p-' + roomName.value.trim(), ydoc, providerOpts);

                provider.awareness.setLocalStateField('user', {
                    name: userName.value.trim() || 'User ' + Math.floor(Math.random() * 1000)
                });

                provider.awareness.on('change', updatePeersList);
                updatePeersList();

                yTranscript = ydoc.getMap('transcript');

                yTranscript.observe(() => {
                    const arr = [];
                    yTranscript.forEach((value) => arr.push(value));
                    arr.sort((a, b) => a.id - b.id);
                    transcript.value = arr;
                });

                if (localJsonBuffer.value && sessionMode.value === 'host') {
                    ydoc.transact(() => {
                        localJsonBuffer.value.forEach(line => {
                            yTranscript.set(String(line.id), line);
                        });
                    });
                    localJsonBuffer.value = null; 
                }
            } catch (err) {
                console.error("Failed to load P2P modules:", err);
                syncError.value = true;
                throw new Error("Не удалось загрузить P2P библиотеки. Проверьте подключение к интернету.");
            }
        };

        const applyLineUpdate = (line, updates) => {
            try {
                if (sessionMode.value === 'local') {
                    const index = transcript.value.findIndex(l => l.id === line.id);
                    if (index !== -1) {
                        transcript.value[index] = { ...transcript.value[index], ...updates };
                    }
                } else {
                    if (yTranscript) {
                        const currentLine = yTranscript.get(String(line.id));
                        yTranscript.set(String(line.id), { ...currentLine, ...updates });
                    } else {
                        throw new Error("P2P network object not initialized");
                    }
                }
                syncError.value = false;
            } catch (e) {
                console.error("Sync error:", e);
                syncError.value = true;
                connectionState.value = 'error';
            }
        };

        const startSession = async () => {
            highlightErrors.value = true;
            if (!isReadyToStart.value) return;
            
            connectionErrorMsg.value = '';
            
            if (sessionMode.value === 'local') {
                transcript.value = [...localJsonBuffer.value];
                localJsonBuffer.value = null;
                isSessionStarted.value = true;
                nextTick(() => { initPlayer(); });
            } else {
                isConnectingP2P.value = true;
                try {
                    await checkServerConnection(activeSignalingServer.value);
                    await initP2P();
                    connectionState.value = 'waiting';
                    isConnectingP2P.value = false;
                    isSessionStarted.value = true;
                    nextTick(() => { initPlayer(); });
                } catch (e) {
                    isConnectingP2P.value = false;
                    connectionErrorMsg.value = e.message;
                }
            }
        };

        const initSpectrogram = () => {
            if (!ws) return;
            if (activeSpectrogramPlugin) {
                try { activeSpectrogramPlugin.destroy(); } catch (e) {}
            }
            activeSpectrogramPlugin = Spectrogram.create({
                labels: false,
                height: 120,
                splitChannels: false,
                frequencyMin: freqMin.value,
                frequencyMax: freqMax.value,
                fftSamples: 2048
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
                container: waveformRef.value,
                waveColor: '#60a5fa',
                progressColor: '#2563eb',
                cursorColor: '#ef4444',
                cursorWidth: 2,
                height: 80,
                interact: false, 
                autoCenter: autoScroll.value,
                url: audioUrl.value,
                plugins: [regionsPlugin]
            });

            initSpectrogram();

            ws.on('ready', () => { isAudioReady.value = true; });
            ws.on('play', () => { isPlaying.value = true; });
            ws.on('pause', () => { isPlaying.value = false; });
            ws.on('timeupdate', (time) => { currentTime.value = time; });

            regionsPlugin.on('region-created', (region) => {
                if (activeLoopRegion && activeLoopRegion !== region) {
                    activeLoopRegion.remove();
                }
                activeLoopRegion = region;
                hasActiveLoop.value = true;
            });

            regionsPlugin.on('region-updated', () => {
                clearTimeout(loopTimeout);
            });
        };

        const onWaveWheel = (e) => {
            if (!ws || !isAudioReady.value) return;

            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                if (e.deltaY > 0) zoomOut();
                else zoomIn();
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
            if (Math.abs(dx) > 5) {
                wasDragged = true;
            }
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
                    const scrollX = sc.scrollLeft;
                    const trueX = scrollX + clickX;
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
        
        const zoomIn = () => {
            zoomLevel.value = Math.min(500, Number(zoomLevel.value) + zoomStep);
            onZoom();
        };
        
        const zoomOut = () => {
            zoomLevel.value = Math.max(10, Number(zoomLevel.value) - zoomStep);
            onZoom();
        };

        const onZoom = () => { 
            if (!ws) return;
            ws.zoom(Number(zoomLevel.value));
            
            clearTimeout(zoomRedrawTimer);
            zoomRedrawTimer = setTimeout(() => {
                initSpectrogram();
            }, 300);
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
                if (regionsPlugin) {
                    disableDragSelectionFn = regionsPlugin.enableDragSelection({
                        color: 'rgba(147, 51, 234, 0.35)'
                    });
                }
            } else {
                if (disableDragSelectionFn) {
                    disableDragSelectionFn();
                    disableDragSelectionFn = null;
                }
                if (regionsPlugin) {
                    regionsPlugin.clearRegions();
                }
                activeLoopRegion = null;
                hasActiveLoop.value = false;
            }
        };

        const isLineInLoop = (id) => {
            if (!isLoopMode.value || !activeLoopRegion) return false;
            const line = transcript.value.find(l => l.id === id);
            if (!line) return false;
            return line.start < activeLoopRegion.end && line.end > activeLoopRegion.start;
        };

        const togglePeersList = () => {
            showPeersList.value = !showPeersList.value;
            if (showPeersList.value) openPickerId.value = null;
        };

        const toggleColorPicker = (id) => { 
            openPickerId.value = openPickerId.value === id ? null : id;
            if (openPickerId.value) showPeersList.value = false;
        };

        const closePopups = () => {
            openPickerId.value = null;
            showPeersList.value = false;
        };

        const setLineColor = (line, colorKey) => {
            applyLineUpdate(line, { color: colorKey });
            openPickerId.value = null;
        };

        const toggleBookmark = (line) => {
            const isBookmarked = !line.is_bookmarked;
            applyLineUpdate(line, { 
                is_bookmarked: isBookmarked, 
                note: (isBookmarked && !line.note) ? '' : line.note 
            });
        };

        const updateNote = (line, newNote) => {
            applyLineUpdate(line, { note: newNote });
        };

        const getColorBarClass = (colorKey) => {
            const found = colorSwatches.find(s => s.key === (colorKey || ''));
            return found ? found.barClass : colorSwatches[0].barClass;
        };

        const getLineCardClasses = (line) => {
            const found = colorSwatches.find(s => s.key === (line.color || '')) || colorSwatches[0];
            return activeLineId.value === line.id ? found.activeCardClass : found.cardClass;
        };

        const formatTime = (seconds) => {
            const m = Math.floor(seconds / 60).toString().padStart(2, '0');
            const s = Math.floor(seconds % 60).toString().padStart(2, '0');
            const ms = Math.floor((seconds % 1) * 10).toString();
            return `${m}:${s}.${ms}`;
        };

        const safeScrollToElement = (id) => {
            const element = document.getElementById(id);
            const container = transcriptContainer.value;
            if (element && container) {
                const containerRect = container.getBoundingClientRect();
                const elementRect = element.getBoundingClientRect();
                const targetTop = container.scrollTop + (elementRect.top - containerRect.top) - (containerRect.height / 2) + (elementRect.height / 2);
                container.scrollTo({ top: targetTop, behavior: 'smooth' });
            }
        };

        const executeSearch = () => {
            hasSearched.value = true;
            const query = searchQuery.value.trim().toLowerCase();
            if (!query) {
                searchResults.value = [];
                return;
            }
            searchResults.value = transcript.value.filter(line => 
                line.text.toLowerCase().includes(query)
            );
            if (searchResults.value.length > 0) {
                currentSearchIndex.value = 0;
                navigateToSearchResult();
            }
        };

        const nextSearch = () => {
            if (searchResults.value.length === 0) return;
            currentSearchIndex.value = (currentSearchIndex.value + 1) % searchResults.value.length;
            navigateToSearchResult();
        };

        const prevSearch = () => {
            if (searchResults.value.length === 0) return;
            currentSearchIndex.value = (currentSearchIndex.value - 1 + searchResults.value.length) % searchResults.value.length;
            navigateToSearchResult();
        };

        const navigateToSearchResult = () => {
            const targetLine = searchResults.value[currentSearchIndex.value];
            if (targetLine) {
                const previousAutoScroll = autoScroll.value;
                autoScroll.value = false;
                if (ws && isPlaying.value) ws.pause();
                
                nextTick(() => {
                    safeScrollToElement('line-' + targetLine.id);
                    setTimeout(() => { autoScroll.value = previousAutoScroll; }, 500);
                });
            }
        };

        const isSearchMatch = (id) => {
            if (searchResults.value.length === 0) return false;
            return searchResults.value[currentSearchIndex.value].id === id;
        };

        const exportBookmarks = () => {
            const dataToSave = transcript.value
                .filter(l => l.is_bookmarked || l.color || l.note) 
                .map(l => ({
                    id: l.id,
                    start: l.start,
                    end: l.end,
                    text: l.text,
                    is_bookmarked: l.is_bookmarked,
                    note: l.note,
                    color: l.color || ''
                }));
            const blob = new Blob([JSON.stringify(dataToSave, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'emca_session_notes.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };

        const importBookmarks = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const importedData = JSON.parse(e.target.result);
                    importedData.forEach(importedLine => {
                        const line = transcript.value.find(l => l.id === importedLine.id);
                        if (line) {
                            applyLineUpdate(line, {
                                is_bookmarked: importedLine.is_bookmarked ?? true,
                                note: importedLine.note || '',
                                color: importedLine.color || ''
                            });
                        }
                    });
                } catch (err) {
                    alert("Error reading JSON file. Check format.");
                }
            };
            reader.readAsText(file);
            event.target.value = '';
        };

        const activeLineId = computed(() => {
            const line = transcript.value.find(l => currentTime.value >= l.start && currentTime.value <= l.end);
            return line ? line.id : null;
        });

        const bookmarkedLines = computed(() => transcript.value.filter(l => l.is_bookmarked));

        watch(autoScroll, (newVal) => {
            if (ws) ws.setOptions({ autoCenter: newVal });
        });

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

            const currentId = activeLineId.value;
            if (currentId && autoScroll.value) {
                await nextTick();
                safeScrollToElement('line-' + currentId);
            }
        });

        return {
            locale,
            t,
            toggleLocale,
            sessionMode,
            setMode,
            isSessionStarted,
            isConnectingP2P,
            connectionState,
            syncError,
            connectionErrorMsg,
            highlightErrors,
            audioUrl,
            audioFileName,
            jsonFileName,
            userName,
            roomName,
            roomPassword,
            serverPreset,
            customServerUrl,
            isReadyToStart,
            isDraggingAudio,
            isDraggingJson,
            handleStartAudio,
            handleStartJson,
            handleAudioDrop,
            handleJsonDrop,
            startSession,
            transcript,
            connectedPeers,
            peersList,
            showPeersList,
            togglePeersList,
            currentTime,
            isPlaying,
            isAudioReady,
            zoomLevel,
            zoomIn,
            zoomOut,
            freqMinInput,
            freqMaxInput,
            freqLabels,
            applyFrequencyRange,
            waveformRef,
            transcriptContainer,
            autoScroll,
            activeLineId,
            bookmarkedLines,
            searchQuery,
            searchResults,
            currentSearchIndex,
            hasSearched,
            isLoopMode,
            hasActiveLoop,
            isDraggingWave,
            onWaveWheel,
            onWavePointerDown,
            onWavePointerMove,
            onWavePointerUp,
            togglePlay,
            onZoom,
            jumpTo,
            toggleLoopMode,
            colorSwatches,
            openPickerId,
            toggleColorPicker,
            closePopups,
            setLineColor,
            getColorBarClass,
            getLineCardClasses,
            toggleBookmark,
            updateNote,
            formatTime,
            executeSearch,
            nextSearch,
            prevSearch,
            isSearchMatch,
            exportBookmarks,
            importBookmarks,
            localJsonBuffer
        };
    }
}).mount('#app');