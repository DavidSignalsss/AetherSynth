/**
 * Aether Synth - Core Audio Engine & Logic
 */

// --- Constants & Utilities ---
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BASE_FREQ = 440; // A4

// Utility to get frequency from note name and octave
function getFrequency(note, octave) {
    const semitonesFromA4 = (octave - 4) * 12 + NOTE_NAMES.indexOf(note) - NOTE_NAMES.indexOf('A');
    return BASE_FREQ * Math.pow(2, semitonesFromA4 / 12);
}

// Simple Impulse Response Generator for Reverb
function createImpulseResponse(audioCtx, duration, decay, reverse) {
    const sampleRate = audioCtx.sampleRate;
    const length = sampleRate * duration;
    const impulse = audioCtx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        const n = reverse ? length - i : i;
        let val = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
        left[i] = val;
        right[i] = val;
    }
    return impulse;
}

// --- Audio Engine Classes ---

class SynthVoice {
    constructor(audioCtx, dest, settings) {
        this.ctx = audioCtx;
        this.dest = dest;
        this.settings = settings;
        this.active = false;
        this.note = null;
        this.octave = null;
        this.oscillators = [];
        this.gainNodes = [];

        this.octave = null;
        this.oscillators = [];
        this.gainNodes = [];
        this.lfo = null;
        this.lfoGain = null;

        this.initGraph();
    }

    initGraph() {
        // Voice Master Gain (VCA)
        this.voiceGain = this.ctx.createGain();
        this.voiceGain.gain.value = 0;

        // Filter (VCF)
        this.filter = this.ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.Q.value = this.settings.filter.res;
        this.filter.frequency.value = this.settings.filter.cutoff;

        // Oscillators
        this.oscSources = [];
        // We create 3 oscs
        for (let i = 1; i <= 3; i++) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.connect(gain);
            gain.connect(this.filter);
            this.oscillators.push(osc);
            this.gainNodes.push(gain);
        }

        // LFO (Per Voice for simplicity in this architecture)
        this.lfo = this.ctx.createOscillator();
        this.lfoGain = this.ctx.createGain();
        this.lfo.connect(this.lfoGain);
        this.lfo.start();

        // LFO (Per Voice for simplicity in this architecture)
        this.lfo = this.ctx.createOscillator();
        this.lfoGain = this.ctx.createGain();
        this.lfo.connect(this.lfoGain);
        this.lfo.start();

        // Connections
        this.filter.connect(this.voiceGain);
        this.voiceGain.connect(this.dest);
    }

    // Helper to scale LFO amount based on destination
    calculateLfoAmount(rawAmt, dest) {
        const val = parseFloat(rawAmt);
        switch (dest) {
            case 'pitch':
                // Refined Vibrato: 0-1000 -> 0-100 cents (1 semitone)
                // This allows very fine control for "pleasant" vibrato.
                return val * 0.1;
            case 'filter':
                // Filter Swim: 0-1000 -> 0-2000 Hz
                return val * 2;
            case 'amp':
                // Tremolo: 0-1000 -> 0-0.5 Gain (Depth)
                return val / 2000;
            default:
                return val;
        }
    }

    triggerAttack(frequency, note, octave) {
        if (this.active) this.triggerRelease();

        this.note = note;
        this.octave = octave;
        this.active = true;

        const now = this.ctx.currentTime;

        // Setup Oscillators
        this.oscillators.forEach((osc, index) => {
            try { osc.stop(); } catch (e) { }

            const newOsc = this.ctx.createOscillator();
            const param = this.settings[`vco${index + 1}`];

            newOsc.type = param.wave;

            // Calculate pitch with octave shift and detune
            const octaveSemis = parseInt(param.octave) * 12;
            const detuneCents = parseInt(param.detune);

            newOsc.frequency.value = frequency * Math.pow(2, octaveSemis / 12);
            newOsc.detune.value = detuneCents;

            // Re-connect
            newOsc.connect(this.gainNodes[index]);
            newOsc.start(now);

            this.oscillators[index] = newOsc;

            // Set Mix Level
            this.gainNodes[index].gain.setValueAtTime(parseFloat(param.gain), now);
        });

        // LFO Logic
        const lfoParams = this.settings.lfo1;
        this.lfo.type = lfoParams.wave;
        this.lfo.frequency.setValueAtTime(parseFloat(lfoParams.rate), now);

        // LFO Routing
        // Disconnect old
        try { this.lfoGain.disconnect(); } catch (e) { }

        const lfoAmt = this.calculateLfoAmount(lfoParams.amt, lfoParams.dest);
        this.lfoGain.gain.setValueAtTime(lfoAmt, now);

        if (lfoAmt > 0) {
            if (lfoParams.dest === 'pitch') {
                // Modulate all osc detunes
                this.oscillators.forEach(osc => this.lfoGain.connect(osc.detune));
            } else if (lfoParams.dest === 'filter') {
                this.lfoGain.connect(this.filter.frequency);
            } else if (lfoParams.dest === 'amp') {
                this.lfoGain.connect(this.voiceGain.gain);
            }
        }

        // Filter Envelope (ADSR)
        const fEnv = this.settings.filter.env;
        const baseFreq = this.settings.filter.cutoff;
        const amt = this.settings.filter.amt;

        this.filter.frequency.cancelScheduledValues(now);
        this.filter.frequency.setValueAtTime(baseFreq, now);
        this.filter.frequency.linearRampToValueAtTime(baseFreq + amt, now + parseFloat(fEnv.a));
        this.filter.frequency.exponentialRampToValueAtTime(baseFreq + (amt * parseFloat(fEnv.s)), now + parseFloat(fEnv.a) + parseFloat(fEnv.d));

        // Amp Envelope (ADSR)
        const aEnv = this.settings.amp.env;
        const masterVol = parseFloat(this.settings.amp.gain); // Use the knob value!
        const maxVol = masterVol > 0 ? masterVol : 0.5;


        this.voiceGain.gain.cancelScheduledValues(now);
        this.voiceGain.gain.setValueAtTime(0, now);
        this.voiceGain.gain.linearRampToValueAtTime(maxVol, now + parseFloat(aEnv.a));
        this.voiceGain.gain.exponentialRampToValueAtTime(maxVol * parseFloat(aEnv.s), now + parseFloat(aEnv.a) + parseFloat(aEnv.d));
    }

    triggerRelease() {
        if (!this.active) return;

        const now = this.ctx.currentTime;
        const aEnv = this.settings.amp.env;
        const fEnv = this.settings.filter.env;
        const baseFreq = this.settings.filter.cutoff;

        // Amp Release
        this.voiceGain.gain.cancelScheduledValues(now);
        this.voiceGain.gain.setValueAtTime(this.voiceGain.gain.value, now);
        this.voiceGain.gain.exponentialRampToValueAtTime(0.001, now + parseFloat(aEnv.r));
        this.voiceGain.gain.linearRampToValueAtTime(0, now + parseFloat(aEnv.r) + 0.01);

        // Filter Release
        this.filter.frequency.cancelScheduledValues(now);
        this.filter.frequency.setValueAtTime(this.filter.frequency.value, now);
        this.filter.frequency.exponentialRampToValueAtTime(baseFreq, now + parseFloat(fEnv.r));

        this.oscillators.forEach(osc => {
            osc.stop(now + parseFloat(aEnv.r) + 0.1);
        });

        this.active = false;
    }

    updateParams(settings) {
        this.settings = settings;
        if (this.active) {
            const now = this.ctx.currentTime;

            // Update Filter
            this.filter.Q.setTargetAtTime(settings.filter.res, now, 0.1);

            // Update Osc Levels
            this.gainNodes.forEach((gn, i) => {
                gn.gain.setTargetAtTime(parseFloat(settings[`vco${i + 1}`].gain), now, 0.1);
            });

            // Update LFO Realtime
            this.lfo.frequency.setTargetAtTime(parseFloat(settings.lfo1.rate), now, 0.1);

            const newLfoAmt = this.calculateLfoAmount(settings.lfo1.amt, settings.lfo1.dest);
            this.lfoGain.gain.setTargetAtTime(newLfoAmt, now, 0.1);

            // Note: Destination change requires re-trigger or complex routing updates. 
            // For now, simple rate/amt updates work. Dest changes on next note is acceptable for simple synth.
        }
    }
}

class AetherSynth {
    constructor() {
        this.ctx = null;
        this.voices = [];
        this.modulatorLFOs = [];

        // Settings State
        this.settings = {
            vco1: { wave: 'sawtooth', octave: 0, detune: 0, gain: 0.8 },
            vco2: { wave: 'square', octave: 0, detune: 5, gain: 0.0 },
            vco3: { wave: 'triangle', octave: -1, detune: 0, gain: 0.0 },
            filter: { cutoff: 2000, res: 1, amt: 2000, env: { a: 0.01, d: 0.2, s: 0.5, r: 0.5 } },
            vco3: { wave: 'triangle', octave: -1, detune: 0, gain: 0.0 },
            filter: { cutoff: 2000, res: 1, amt: 2000, env: { a: 0.01, d: 0.2, s: 0.5, r: 0.5 } },
            amp: { gain: 0.5, env: { a: 0.01, d: 0.1, s: 0.8, r: 0.3 } },
            lfo1: { wave: 'sine', rate: 5, amt: 0, dest: 'pitch' },
            fx: {
                chorus: { rate: 1.5, depth: 0.5, mix: 0 },
                delay: { time: 0.3, fdbk: 0.4, mix: 0 },
                reverb: { decay: 2, mix: 0 }
            },
            eq: { low: 0, mid: 0, high: 0 },
            polyphony: 4
        };

        this.maxPolyphony = 4;
    }

    async init() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        await this.ctx.resume();

        // Master Graph
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.8;

        // EQ Chain
        this.eqLow = this.ctx.createBiquadFilter();
        this.eqLow.type = 'lowshelf';
        this.eqLow.frequency.value = 320; // Classic low shelf

        this.eqMid = this.ctx.createBiquadFilter();
        this.eqMid.type = 'peaking';
        this.eqMid.frequency.value = 1000;
        this.eqMid.Q.value = 1.0;

        this.eqHigh = this.ctx.createBiquadFilter();
        this.eqHigh.type = 'highshelf';
        this.eqHigh.frequency.value = 3200;

        // Visualizer Setup
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;

        // Chorus Effect
        this.chorusDelay = this.ctx.createDelay();
        this.chorusDelay.delayTime.value = 0.03; // 30ms base
        this.chorusLFO = this.ctx.createOscillator();
        this.chorusLFO.frequency.value = 1.5;
        this.chorusDepth = this.ctx.createGain();
        this.chorusDepth.gain.value = 0.002; // Modulation depth
        this.chorusMixNode = this.ctx.createGain();
        this.chorusDryNode = this.ctx.createGain();

        // Chorus Wiring
        this.chorusLFO.connect(this.chorusDepth);
        this.chorusDepth.connect(this.chorusDelay.delayTime);
        this.chorusLFO.start();

        // Effects Chain
        this.delayNode = this.ctx.createDelay();
        this.delayFeedback = this.ctx.createGain();
        this.delayWet = this.ctx.createGain();
        this.reverbNode = this.ctx.createConvolver();
        this.reverbWet = this.ctx.createGain();

        this.voiceOutput = this.ctx.createGain(); // Summing bus

        // Bus -> EQ -> Effects -> Master

        // Connect EQ
        this.voiceOutput.connect(this.eqLow);
        this.eqLow.connect(this.eqMid);
        this.eqMid.connect(this.eqHigh);

        // EQ -> Chorus
        const chorusInput = this.eqHigh;

        // Chorus Logic (Dry/Wet)
        chorusInput.connect(this.chorusDryNode); // Dry path
        chorusInput.connect(this.chorusDelay);   // Wet path input
        this.chorusDelay.connect(this.chorusMixNode); // Wet path output

        // Sum Chorus (Dry + Wet) -> Post Chorus Bus
        const postChorus = this.ctx.createGain();
        this.chorusDryNode.connect(postChorus);
        this.chorusMixNode.connect(postChorus);

        // Split from Post Chorus to FX and Dry (Master)
        // Delay Logic
        postChorus.connect(this.delayNode);
        this.delayNode.connect(this.delayFeedback);
        this.delayFeedback.connect(this.delayNode);
        this.delayNode.connect(this.delayWet);
        this.delayWet.connect(this.masterGain);

        // Reverb Logic
        this.reverbImpulse = createImpulseResponse(this.ctx, 2, 2, false);
        this.reverbNode.buffer = this.reverbImpulse;
        postChorus.connect(this.reverbNode);
        this.reverbNode.connect(this.reverbWet);
        this.reverbWet.connect(this.masterGain);

        // Dry Signal (Main Path)
        postChorus.connect(this.masterGain);

        // Analyser
        this.masterGain.connect(this.analyser);

        this.masterGain.connect(this.ctx.destination);

        this.updateEffects();
        startVisualizer(this.analyser);
        console.log("Audio Engine Initialized with EQ, Chorus, and Visualizer");
    }

    startNote(note, octave) {
        if (!this.ctx) return;
        let voice = this.voices.find(v => !v.active);
        if (!voice) {
            if (this.voices.length < this.maxPolyphony) {
                voice = new SynthVoice(this.ctx, this.voiceOutput, this.settings);
                this.voices.push(voice);
            } else {
                voice = this.voices[0]; // simplistic stealing
            }
        }
        const freq = getFrequency(note, octave);
        voice.triggerAttack(freq, note, octave);
    }

    stopNote(note, octave) {
        if (!this.ctx) return;
        const voice = this.voices.find(v => v.active && v.note === note && v.octave === octave);
        if (voice) {
            voice.triggerRelease();
        }
    }

    updateEffects() {
        if (!this.ctx) return;

        // Delay
        this.delayNode.delayTime.setTargetAtTime(parseFloat(this.settings.fx.delay.time), this.ctx.currentTime, 0.1);
        this.delayFeedback.gain.setTargetAtTime(parseFloat(this.settings.fx.delay.fdbk), this.ctx.currentTime, 0.1);
        this.delayWet.gain.setTargetAtTime(parseFloat(this.settings.fx.delay.mix), this.ctx.currentTime, 0.1);

        // Reverb
        this.reverbWet.gain.setTargetAtTime(parseFloat(this.settings.fx.reverb.mix), this.ctx.currentTime, 0.1);

        // Chorus
        this.chorusLFO.frequency.setTargetAtTime(parseFloat(this.settings.fx.chorus.rate), this.ctx.currentTime, 0.1);
        // Depth mapping: 0-1 -> 0-0.005s (0-5ms)
        const depthVal = parseFloat(this.settings.fx.chorus.depth) * 0.005;
        this.chorusDepth.gain.setTargetAtTime(depthVal, this.ctx.currentTime, 0.1);

        // Chorus Mix: simple Dry/Wet crossfade or just level? 
        // User asked for "Mix". Let's do equal power or linear crossfade.
        // For simplicity: Dry = 1 - Mix, Wet = Mix
        const mix = parseFloat(this.settings.fx.chorus.mix);
        this.chorusDryNode.gain.setTargetAtTime(1 - mix, this.ctx.currentTime, 0.1);
        this.chorusMixNode.gain.setTargetAtTime(mix, this.ctx.currentTime, 0.1);


        // EQ
        this.eqLow.gain.setTargetAtTime(parseFloat(this.settings.eq.low), this.ctx.currentTime, 0.1);
        this.eqMid.gain.setTargetAtTime(parseFloat(this.settings.eq.mid), this.ctx.currentTime, 0.1);
        this.eqHigh.gain.setTargetAtTime(parseFloat(this.settings.eq.high), this.ctx.currentTime, 0.1);
    }

    updateSetting(path, value) {
        const parts = path.split('.');
        if (parts.length === 2) {
            this.settings[parts[0]][parts[1]] = value;
        } else if (parts.length === 3) {
            this.settings[parts[0]][parts[1]][parts[2]] = value;
        }

        this.voices.forEach(v => v.updateParams(this.settings));
        this.updateEffects();
    }
}

// --- Main Logic ---

const synth = new AetherSynth();

// UI Elements
const startBtn = document.getElementById('start-audio-btn');
const keyboardContainer = document.getElementById('virtual-keyboard');
const tooltip = document.getElementById('tooltip');

// Init
function init() {
    generateKeyboard();
    setupEventListeners();
}

function generateKeyboard() {
    keyboardContainer.innerHTML = '';
    const octaves = 3;
    const startOctave = 3;

    for (let oct = 0; oct < octaves; oct++) {
        for (let i = 0; i < 12; i++) {
            const noteName = NOTE_NAMES[i];
            const isBlack = noteName.includes('#');
            const key = document.createElement('div');

            key.className = `key ${isBlack ? 'black' : 'white'}`;
            key.dataset.note = noteName;
            key.dataset.octave = startOctave + oct;

            key.addEventListener('mousedown', () => noteOn(key));
            key.addEventListener('mouseup', () => noteOff(key));
            key.addEventListener('mouseleave', () => noteOff(key));

            keyboardContainer.appendChild(key);
        }
    }
}

function setupEventListeners() {
    // Start Audio
    startBtn.addEventListener('click', async () => {
        if (!synth.ctx) {
            await synth.init();
            startBtn.textContent = "Audio Active";
            startBtn.classList.add('active'); // Changed class for active state logic
            startBtn.classList.add('primary'); // Ensure primary style
            document.getElementById('onboarding-modal').classList.add('hidden');
        }
    });

    // Help & Settings
    document.getElementById('help-btn').addEventListener('click', () => {
        document.getElementById('onboarding-modal').classList.remove('hidden');
    });
    document.getElementById('close-modal-btn').addEventListener('click', () => {
        document.getElementById('onboarding-modal').classList.add('hidden');
    });
    document.getElementById('settings-btn').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.remove('hidden');
    });
    document.getElementById('close-settings-btn').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('hidden');
    });

    // Inputs & Parameter Mapping
    const map = {
        'vco1-wave': 'vco1.wave', 'vco1-octave': 'vco1.octave', 'vco1-detune': 'vco1.detune', 'vco1-gain': 'vco1.gain',
        'vco2-wave': 'vco2.wave', 'vco2-octave': 'vco2.octave', 'vco2-detune': 'vco2.detune', 'vco2-gain': 'vco2.gain',
        'vco3-wave': 'vco3.wave', 'vco3-octave': 'vco3.octave', 'vco3-detune': 'vco3.detune', 'vco3-gain': 'vco3.gain',

        'filter-cutoff': 'filter.cutoff', 'filter-res': 'filter.res', 'filter-env-amt': 'filter.amt',
        'filter-attack': 'filter.env.a', 'filter-decay': 'filter.env.d', 'filter-sustain': 'filter.env.s', 'filter-release': 'filter.env.r',

        'master-gain': 'amp.gain',
        'amp-attack': 'amp.env.a', 'amp-decay': 'amp.env.d', 'amp-sustain': 'amp.env.s', 'amp-release': 'amp.env.r',

        'lfo1-wave': 'lfo1.wave', 'lfo1-rate': 'lfo1.rate', 'lfo1-amount': 'lfo1.amt', 'lfo1-dest': 'lfo1.dest',

        'delay-time': 'fx.delay.time', 'delay-feedback': 'fx.delay.fdbk', 'delay-mix': 'fx.delay.mix',
        'reverb-mix': 'fx.reverb.mix', 'reverb-decay': 'fx.reverb.decay',
        'chorus-rate': 'fx.chorus.rate', 'chorus-depth': 'fx.chorus.depth', 'chorus-mix': 'fx.chorus.mix',

        'eq-low': 'eq.low', 'eq-mid': 'eq.mid', 'eq-high': 'eq.high'
    };

    document.querySelectorAll('input, select').forEach(el => {
        // Audio Update
        el.addEventListener('input', (e) => {
            const settingPath = map[e.target.id];
            if (settingPath) {
                synth.updateSetting(settingPath, e.target.value);
            }
            updateVisuals(e.target);
            showTooltip(e.target);
        });

        // Initial Visual State
        if (el.type === 'range') {
            updateVisuals(el);
            el.addEventListener('mousedown', (e) => showTooltip(e.target));
            el.addEventListener('mouseup', () => hideTooltip());
            el.addEventListener('mouseleave', () => hideTooltip());
        }
    });

    // PC Keyboard
    window.addEventListener('keydown', handlePCKeydown);
    window.addEventListener('keyup', handlePCKeyup);
}

// --- Visual Helpers (Knobs & Tooltips) ---

function updateVisuals(input) {
    if (input.classList.contains('knob') || input.classList.contains('knob-small')) {
        const min = parseFloat(input.min);
        const max = parseFloat(input.max);
        const val = parseFloat(input.value);

        // Map value to -135deg to +135deg (total 270deg rotation)
        const percent = (val - min) / (max - min);
        const deg = -135 + (percent * 270);

        // Find sibling visual
        const container = input.closest('.knob-container');
        const visual = container.querySelector('.knob-visual');
        if (visual) {
            visual.style.transform = `rotate(${deg}deg)`;
        }
    }
}

function showTooltip(input) {
    const label = input.dataset.tooltip;
    if (!label) return;

    const rect = input.getBoundingClientRect();
    const val = parseFloat(input.value);
    let displayVal = val.toFixed(2);

    // Custom Formatting
    if (label === 'Octave') displayVal = `${val > 0 ? '+' : ''}${val}`;
    if (label === 'Detune') displayVal = `${val} ct`;
    if (label === 'Freq' || label === 'Cutoff') displayVal = `${Math.round(val)} Hz`;
    if (label.includes('Gain') || label.includes('Level') || label === 'Volume') displayVal = `${Math.round(val * 100)}%`;
    if (label.includes('dB')) displayVal = `${val} dB`; // For EQ if I change mapping

    // For EQ inputs specifically, they are dB
    if (input.id.includes('eq')) displayVal = `${val > 0 ? '+' : ''}${val} dB`;

    tooltip.textContent = `${label}: ${displayVal}`;
    tooltip.classList.remove('hidden');

    // Position
    const tooltipRect = tooltip.getBoundingClientRect();
    tooltip.style.left = `${rect.left + (rect.width / 2) - (tooltipRect.width / 2)}px`;
    tooltip.style.top = `${rect.top - 30}px`;
}

function hideTooltip() {
    tooltip.classList.add('hidden');
}

// --- Note Logic ---

function noteOn(keyElement) {
    if (!synth.ctx) return;
    keyElement.classList.add('active');
    const note = keyElement.dataset.note;
    const octave = parseInt(keyElement.dataset.octave);
    synth.startNote(note, octave);
}

function noteOff(keyElement) {
    if (!synth.ctx) return;
    keyElement.classList.remove('active');
    const note = keyElement.dataset.note;
    const octave = parseInt(keyElement.dataset.octave);
    synth.stopNote(note, octave);
}

// PC Keyboard Mapping
const keyMap = {
    'a': 'C3', 'w': 'C#3', 's': 'D3', 'e': 'D#3', 'd': 'E3',
    'f': 'F3', 't': 'F#3', 'g': 'G3', 'y': 'G#3', 'h': 'A3', 'u': 'A#3', 'j': 'B3',
    'k': 'C4', 'o': 'C#4', 'l': 'D4'
};
const activeKeys = new Set();

function handlePCKeydown(e) {
    if (activeKeys.has(e.key)) return;
    const noteStr = keyMap[e.key];
    if (noteStr) {
        activeKeys.add(e.key);
        const note = noteStr.slice(0, -1);
        const octave = noteStr.slice(-1);
        const keyEl = Array.from(document.querySelectorAll('.key')).find(k => k.dataset.note === note && k.dataset.octave === octave);
        if (keyEl) noteOn(keyEl);
    }
}

function handlePCKeyup(e) {
    if (activeKeys.has(e.key)) {
        activeKeys.delete(e.key);
        const noteStr = keyMap[e.key];
        if (noteStr) {
            const note = noteStr.slice(0, -1);
            const octave = noteStr.slice(-1);
            const keyEl = Array.from(document.querySelectorAll('.key')).find(k => k.dataset.note === note && k.dataset.octave === octave);
            if (keyEl) noteOff(keyEl);
        }
    }
}

init();

// --- Visualizer ---
function startVisualizer(analyser) {
    const canvas = document.getElementById('oled-display');
    const ctx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Fix High DPI Canvas
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // OLED Color
    ctx.strokeStyle = '#4ECDC4';
    ctx.lineWidth = 2;

    function draw() {
        requestAnimationFrame(draw);

        analyser.getByteTimeDomainData(dataArray);

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, rect.width, rect.height);

        ctx.beginPath();

        const sliceWidth = rect.width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = v * (rect.height / 2);

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        ctx.lineTo(rect.width, rect.height / 2);
        ctx.stroke();
    }

    draw();
}
