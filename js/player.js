/**
 * WaveSurfer, Spectrogram, Regions, active timecode highlighting,
 * and Video controls for EMCA Data Session Explorer.
 */

import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js';
import Spectrogram from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/spectrogram.esm.js';
import RegionsPlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/regions.esm.js';

export { WaveSurfer, Spectrogram, RegionsPlugin };

export const clearSegmentHighlight = (editorElement) => {
    if (editorElement) {
        const highlighted = editorElement.querySelectorAll('.active-segment-highlight');
        highlighted.forEach(el => el.classList.remove('active-segment-highlight'));
    }
};

export const updateActiveSegmentHighlight = (editorElement, time, currentRange = null) => {
    if (!editorElement) return null;

    if (currentRange) {
        if (time >= currentRange.start && time <= currentRange.end) {
            const activeElements = editorElement.querySelectorAll('.active-segment-highlight');
            if (activeElements.length > 0) {
                return currentRange;
            }
        }
    }

    const allSpans = editorElement.querySelectorAll('[data-start]');
    if (!allSpans || allSpans.length === 0) {
        clearSegmentHighlight(editorElement);
        return null;
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
        clearSegmentHighlight(editorElement);
        return null;
    }

    const oldHighlighted = editorElement.querySelectorAll('.active-segment-highlight');
    oldHighlighted.forEach(el => el.classList.remove('active-segment-highlight'));

    for (let i = 0; i < allSpans.length; i++) {
        const el = allSpans[i];
        const s = parseFloat(el.getAttribute('data-start'));
        const e = parseFloat(el.getAttribute('data-end'));
        const safeEnd = !isNaN(e) ? e : s;
        if (s === targetStart && safeEnd === targetEnd) {
            el.classList.add('active-segment-highlight');
        }
    }

    const newRange = { start: targetStart, end: targetEnd };

    if (firstMatchingEl) {
        const container = editorElement.closest('.overflow-y-auto');
        if (container) {
            const elRect = firstMatchingEl.getBoundingClientRect();
            const cRect = container.getBoundingClientRect();
            if (elRect.top < cRect.top || elRect.bottom > cRect.bottom) {
                firstMatchingEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }

    return newRange;
};

export const createSpectrogramPlugin = ({ freqMin, freqMax }) => {
    return Spectrogram.create({
        labels: false,
        height: 120,
        splitChannels: false,
        frequencyMin: freqMin,
        frequencyMax: freqMax,
        fftSamples: 2048
    });
};

export const computeFrequencyLabels = (freqMin, freqMax) => {
    const min = Number(freqMin) || 0;
    const max = Number(freqMax) || 500;
    const step = (max - min) / 4;
    const labels = [];
    for (let i = 4; i >= 0; i--) {
        const val = Math.round(min + step * i);
        labels.push(val >= 1000 ? (val / 1000).toFixed(1) + ' kHz' : val + ' Hz');
    }
    return labels;
};

export const getWaveScrollContainer = (ws) => {
    if (!ws) return null;
    const wrapper = ws.getWrapper();
    return wrapper ? wrapper.parentElement : null;
};

export const togglePiP = async (videoElement) => {
    if (!videoElement) return;
    try {
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled) {
            await videoElement.requestPictureInPicture();
        }
    } catch (e) {
        console.error('PiP error:', e);
        alert('Picture-in-Picture is not supported or blocked by the browser.');
    }
};


export const createPlayer = ({
    container,
    media = null,
    audioUrl = null,
    autoCenter = true,
    isVideo = false,
    onReady = null,
    onTimeUpdate = null,
    onFinish = null,
    onPlay = null,
    onPause = null,
    onRegionCreated = null,
    onRegionUpdated = null
}) => {
    const regionsPlugin = RegionsPlugin.create();
    const wsConfig = {
        container,
        waveColor: '#60a5fa',
        progressColor: '#2563eb',
        cursorColor: '#ef4444',
        cursorWidth: 2,
        height: 80,
        interact: false,
        autoCenter,
        plugins: [regionsPlugin]
    };

    if (isVideo && media) {
        wsConfig.media = media;
    } else if (audioUrl) {
        wsConfig.url = audioUrl;
    }

    const ws = WaveSurfer.create(wsConfig);

    if (onReady) ws.on('ready', () => onReady(ws));
    if (onTimeUpdate) ws.on('timeupdate', (time) => onTimeUpdate(time, ws));
    if (onFinish) ws.on('finish', () => onFinish(ws));
    if (onPlay) ws.on('play', () => onPlay(ws));
    if (onPause) ws.on('pause', () => onPause(ws));

    if (onRegionCreated) regionsPlugin.on('region-created', (region) => onRegionCreated(region, ws));
    if (onRegionUpdated) regionsPlugin.on('region-updated', (region) => onRegionUpdated(region, ws));

    return { ws, regionsPlugin };
};


export const createWaveInteraction = ({
    getWs,
    getIsAudioReady,
    getIsLoopMode,
    getScrollContainer,
    onTimeChange,
    onSegmentHighlight,
    onDraggingChange,
    zoomIn,
    zoomOut
}) => {
    let isDraggingWave = false;
    let pointerStartX = 0;
    let initialScrollLeft = 0;
    let wasDragged = false;

    const onWaveWheel = (e) => {
        const ws = getWs();
        if (!ws || !getIsAudioReady()) return;
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
        const ws = getWs();
        if (!ws || !getIsAudioReady() || getIsLoopMode()) return;
        isDraggingWave = true;
        if (onDraggingChange) onDraggingChange(true);
        wasDragged = false;
        pointerStartX = e.clientX;
        const sc = getScrollContainer();
        initialScrollLeft = sc ? sc.scrollLeft : 0;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    };

    const onWavePointerMove = (e) => {
        const ws = getWs();
        if (!isDraggingWave || getIsLoopMode() || !ws) return;
        const dx = e.clientX - pointerStartX;
        if (Math.abs(dx) > 5) wasDragged = true;
        if (wasDragged) {
            const sc = getScrollContainer();
            if (sc) sc.scrollLeft = initialScrollLeft - dx;
        }
    };

    const onWavePointerUp = (e) => {
        if (!isDraggingWave) return;
        isDraggingWave = false;
        if (onDraggingChange) onDraggingChange(false);
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}

        const ws = getWs();
        if (!wasDragged && !getIsLoopMode() && ws) {
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
                    if (onTimeChange) onTimeChange(newTime);
                    if (onSegmentHighlight) onSegmentHighlight(newTime);
                }
            }
        }
        wasDragged = false;
    };

    return {
        onWaveWheel,
        onWavePointerDown,
        onWavePointerMove,
        onWavePointerUp,
        getIsDraggingWave: () => isDraggingWave
    };
};
