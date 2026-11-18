/**
 * WebRTC P2P signaling, ICE configuration, awareness, and IndexedDB persistence
 * for EMCA Data Session Explorer.
 */

import { IndexeddbPersistence } from 'https://esm.sh/y-indexeddb@9.0.12?deps=yjs@13.6.18';

export { IndexeddbPersistence };

export const PUBLIC_SIGNALING_SERVERS = [
    'wss://signaling.yjs.dev',
    'wss://y-webrtc-signaling-eu.herokuapp.com',
    'wss://y-webrtc-signaling-us.herokuapp.com'
];

export const checkSignalingConnection = (servers) => {
    const list = Array.isArray(servers) ? servers : [servers];
    if (list.length === 0) return Promise.reject(new Error("Список сигнальных серверов пуст."));

    return new Promise((resolve, reject) => {
        let settled = false;
        let pending = list.length;
        const sockets = [];

        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                sockets.forEach(s => { try { s.close(); } catch (_) {} });
                reject(new Error("Таймаут соединения с сигнальными серверами (5с)."));
            }
        }, 5000);

        list.forEach(url => {
            let failed = false;
            const markFailed = (errMsg) => {
                if (failed || settled) return;
                failed = true;
                pending--;
                if (pending <= 0 && !settled) {
                    settled = true;
                    clearTimeout(timeout);
                    reject(new Error(errMsg || "Не удалось подключиться ни к одному сигнальному серверу. Проверьте сеть или используйте другой сервер."));
                }
            };

            try {
                const ws = new WebSocket(url);
                sockets.push(ws);
                ws.onopen = () => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timeout);
                        sockets.forEach(s => { try { s.close(); } catch (_) {} });
                        resolve(url);
                    }
                };
                ws.onerror = () => {
                    markFailed();
                };
                ws.onclose = () => {
                    markFailed();
                };
            } catch (err) {
                markFailed(err.message);
            }
        });
    });
};

export const fetchAutoIceServers = async (signalingUrl) => {
    if (!signalingUrl || typeof signalingUrl !== 'string') return null;
    try {
        const httpUrl = signalingUrl
            .replace(/^wss:\/\//i, 'https://')
            .replace(/^ws:\/\//i, 'http://')
            .replace(/\/+$/, '') + '/ice-config';

        const res = await fetch(httpUrl, { 
            method: 'GET', 
            headers: { 'Accept': 'application/json' },
            signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(3000) : undefined 
        });

        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
                return data.iceServers;
            }
        }
    } catch (_) {
        // Silently return null on timeout/error
    }
    return null;
};

export const buildIceServers = async ({
    useTurnServer = false,
    turnPreset = 'openrelay',
    customTurnUrl = '',
    customTurnUsername = '',
    customTurnCredential = '',
    isCustomSignaling = false,
    signalingUrl = ''
} = {}) => {
    const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
    ];

    const hasExplicitCustomTurn = useTurnServer && turnPreset === 'custom' && customTurnUrl.trim() !== '';

    if (useTurnServer) {
        if (turnPreset === 'openrelay') {
            iceServers.push(
                { urls: 'turn:openrelay.metered.ca:80', username: 'openrelay', credential: 'openrelay' },
                { urls: 'turn:openrelay.metered.ca:443', username: 'openrelay', credential: 'openrelay' },
                { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelay', credential: 'openrelay' },
                { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelay', credential: 'openrelay' }
            );
        } else if (hasExplicitCustomTurn) {
            const customIce = { urls: customTurnUrl.trim() };
            if (customTurnUsername.trim()) customIce.username = customTurnUsername.trim();
            if (customTurnCredential.trim()) customIce.credential = customTurnCredential.trim();
            iceServers.push(customIce);
        }
    }

    if (isCustomSignaling && !hasExplicitCustomTurn && signalingUrl) {
        const autoIce = await fetchAutoIceServers(signalingUrl);
        if (autoIce && Array.isArray(autoIce)) {
            iceServers.push(...autoIce);
        }
    }

    return iceServers;
};


export const initIndexeddbPersistence = (dbKey, ydoc) => {
    return new IndexeddbPersistence(dbKey, ydoc);
};

export const clearIndexeddbData = async (dbKey, Y) => {
    const tempIdb = new IndexeddbPersistence(dbKey, new Y.Doc());
    await tempIdb.clearData();
    tempIdb.destroy();
};

export const initWebRtcProvider = async ({
    roomName,
    roomPassword = '',
    ydoc,
    signalingServers,
    iceServers,
    userName,
    userColor = '#0ea5e9',
    onStatus = null,
    onPeers = null,
    onAwarenessChange = null,
}) => {
    const webrtcModule = await import('https://esm.sh/y-webrtc@10.3.0?deps=yjs@13.6.18');
    const WebrtcProvider = webrtcModule.WebrtcProvider;

    const providerOpts = {
        signaling: signalingServers,
        peerOpts: {
            config: {
                iceServers: iceServers,
                iceCandidatePoolSize: 10
            }
        }
    };
    if (roomPassword && roomPassword.trim() !== '') {
        providerOpts.password = roomPassword.trim();
    }

    const provider = new WebrtcProvider('emca-p2p-' + roomName.trim(), ydoc, providerOpts);

    provider.awareness.setLocalStateField('user', {
        name: (userName && userName.trim()) || 'User ' + Math.floor(Math.random() * 1000),
        color: userColor
    });

    if (onStatus) {
        provider.on('status', onStatus);
    }
    if (onPeers) {
        provider.on('peers', onPeers);
    }
    if (onAwarenessChange) {
        provider.awareness.on('change', onAwarenessChange);
        provider.awareness.on('update', onAwarenessChange);
    }

    return provider;
};

export const getPeersList = (provider, ydoc) => {
    if (!provider) return { count: 1, list: [] };
    const states = provider.awareness.getStates();
    const arr = [];
    states.forEach((state, clientId) => {
        arr.push({
            id: clientId,
            name: state.user?.name || 'Anonymous',
            isMe: clientId === ydoc?.clientID
        });
    });

    arr.sort((a, b) => {
        if (a.isMe) return -1;
        if (b.isMe) return 1;
        return a.name.localeCompare(b.name);
    });

    return { count: states.size, list: arr };
};


export const startSessionWorkflow = async ({
    sessionMode,
    roomName,
    roomPassword,
    serverPreset,
    customServerUrl,
    activeSignalingServers,
    useTurnServer,
    turnPreset,
    customTurnUrl,
    customTurnUsername,
    customTurnCredential,
    userName,
    userColor,
    localJsonBuffer,
    onStatus,
    onPeers,
    onAwarenessChange
}) => {
    if (sessionMode !== 'local' && serverPreset === 'custom') {
        const urls = customServerUrl.split(',').map(s => s.trim()).filter(Boolean);
        const hasValidUrl = urls.some(u => u.startsWith('wss://') || u.startsWith('ws://'));
        if (!hasValidUrl) {
            throw new Error('Ошибка: URL сервера должен начинаться с wss:// или ws://');
        }
    }

    if (sessionMode !== 'local') {
        await checkSignalingConnection(activeSignalingServers);
    }

    const yjsModule = await import('https://esm.sh/yjs@13.6.18');
    const Y = yjsModule.default || yjsModule;

    const dbKey = sessionMode === 'local' 
        ? 'emca_autosave_local' 
        : `emca_autosave_${(roomName || '').trim()}`;

    const isFreshJsonStart = Boolean(localJsonBuffer && !localJsonBuffer._yjs_state);
    const isJsonRestore = Boolean(localJsonBuffer && localJsonBuffer._yjs_state);

    if (sessionMode === 'host' || sessionMode === 'local') {
        if (isFreshJsonStart || isJsonRestore) {
            await clearIndexeddbData(dbKey, Y);
        }
    }

    const ydoc = new Y.Doc();

    if (isJsonRestore) {
        const { base64ToUint8Array } = await import('./utils.js');
        Y.applyUpdate(ydoc, base64ToUint8Array(localJsonBuffer._yjs_state));
    }

    const idbProvider = initIndexeddbPersistence(dbKey, ydoc);
    let provider = null;

    if (sessionMode !== 'local') {
        const iceServers = await buildIceServers({
            useTurnServer,
            turnPreset,
            customTurnUrl,
            customTurnUsername,
            customTurnCredential,
            isCustomSignaling: serverPreset === 'custom',
            signalingUrl: activeSignalingServers[0]
        });

        provider = await initWebRtcProvider({
            roomName,
            roomPassword,
            ydoc,
            signalingServers: activeSignalingServers,
            iceServers,
            userName,
            userColor,
            onStatus,
            onPeers,
            onAwarenessChange
        });
    }

    return {
        ydoc,
        provider,
        idbProvider,
        dbKey
    };
};


export const setupSessionMaps = ({ ydoc, onCommentsChange, onProposalsChange }) => {
    const yComments = ydoc.getMap('emca-comments');
    const yMeta = ydoc.getMap('emca-meta');
    const yProposals = ydoc.getMap('emca-proposals');

    if (onCommentsChange) {
        yComments.observeDeep(onCommentsChange);
    }
    if (onProposalsChange) {
        yProposals.observe(onProposalsChange);
    }

    return { yComments, yMeta, yProposals };
};
