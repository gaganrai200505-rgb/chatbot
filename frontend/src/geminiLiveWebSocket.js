/**
 * geminiLiveWebSocket.js — Gemini 2.0 Multimodal Live Voice-to-Voice WebSocket Client
 * ===================================================================================
 * Manages full-duplex real-time audio input/output, WebAudio AudioWorklet PCM synthesis,
 * system instruction setup, and DB RAG tool-calling execution.
 */

import { fetchGeminiLiveConfig, executeToolSearch } from './api';

const PCM_WORKLET_CODE = `
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0] && input[0].length > 0) {
      const inputData = input[0];
      const copy = new Float32Array(inputData.length);
      copy.set(inputData);
      this.port.postMessage(copy.buffer, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
`;

/** High-quality resampler & RMS calculator: converts hardware Float32 audio to 16,000Hz Int16 PCM */
function processAndResamplePCM(inputFloat32, nativeSampleRate) {
  if (!inputFloat32 || inputFloat32.length === 0) return { pcmInt16: new Int16Array(0), rms: 0 };

  // 1. Calculate RMS volume level for instant Barge-In detection
  let sum = 0;
  for (let i = 0; i < inputFloat32.length; i++) {
    const s = inputFloat32[i];
    sum += s * s;
  }
  const rms = Math.sqrt(sum / inputFloat32.length);

  // 2. Resample from native hardware sample rate to 16,000Hz
  let resampledFloat32;
  if (nativeSampleRate === 16000) {
    resampledFloat32 = inputFloat32;
  } else {
    const ratio = nativeSampleRate / 16000;
    const newLen = Math.floor(inputFloat32.length / ratio);
    resampledFloat32 = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const originIdx = i * ratio;
      const idxFloor = Math.floor(originIdx);
      const idxCeil = Math.min(inputFloat32.length - 1, Math.ceil(originIdx));
      const factor = originIdx - idxFloor;
      resampledFloat32[i] = inputFloat32[idxFloor] * (1 - factor) + inputFloat32[idxCeil] * factor;
    }
  }

  // 3. Convert Float32 to Int16 PCM
  const pcmInt16 = new Int16Array(resampledFloat32.length);
  for (let i = 0; i < resampledFloat32.length; i++) {
    const s = Math.max(-1, Math.min(1, resampledFloat32[i]));
    pcmInt16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  return { pcmInt16, rms };
}

export class GeminiLiveSession {
  constructor({ onSpeechStart, onSpeechEnd, onTextChunk, onToolCall, onError, onClose, onMicError, voiceGender = 'female', currentLanguage = 'auto' }) {
    this.onSpeechStart = onSpeechStart;
    this.onSpeechEnd = onSpeechEnd;
    this.onTextChunk = onTextChunk;
    this.onToolCall = onToolCall;
    this.onError = onError;
    this.onClose = onClose;
    this.onMicError = onMicError || (() => {});
    this.voiceGender = voiceGender;
    this.currentLanguage = currentLanguage;

    this.ws = null;
    this.audioCtx = null;
    this.micAudioCtx = null;
    this.micStream = null;
    this.audioWorkletNode = null;
    this.scriptProcessor = null;
    this.nextStartTime = 0;
    this.activeSources = [];
    this.isConnected = false;
    this.config = null;
  }

  /** Open a single WebSocket for a given model and resolve when setup is acked. */
  openSocketForModel(apiKey, model) {
    return new Promise((resolve) => {
      let settled = false;
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

      let ws;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        console.warn(`[GeminiLive] WebSocket construction failed for ${model}:`, err.message);
        resolve(false);
        return;
      }

      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(verifyTimer);
        if (!ok && ws) {
          try {
            ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null;
            ws.close();
          } catch {}
        }
        resolve(ok);
      };

      // If the model name is rejected, the server closes shortly after open.
      // Treat ANY server message (setupComplete is not sent by every release —
      // live audio/text may arrive directly) as success. A 5s verification
      // window lets a legit model respond even on real-world networks, without
      // timing out prematurely.
      let sawAnyServerMessage = false;
      const verifyTimer = setTimeout(() => {
        console.warn(`[GeminiLive] No server response within 5.0s for model ${model} — trying next`);
        finish(false);
      }, 5000);

      ws.onopen = () => {
        console.log(`[GeminiLive] WebSocket open for ${model} ✓`);
        // Guard: keep handlers attached; setup ack decides success
        try { ws.send(JSON.stringify(this._buildSetupPayload(model))); } catch {}
      };

      const activate = () => {
        if (settled) return;
        console.log(`[GeminiLive] Live model active: ${model} ✓`);
        this.ws = ws;
        this.isConnected = true;
        ws.onmessage = (ev) => this._handleServerMessageEvent(ev);
        ws.onclose = () => { this.isConnected = false; if (this.onClose) this.onClose(); };
        ws.onerror = (err) => { if (this.onError) this.onError(err); };
        finish(true);
      };

      ws.onmessage = (event) => {
        // Any parseable server message post-open means the model is LIVE —
        // setupComplete is not guaranteed on every release; some respond with
        // live audio/text or tool calls directly. A rejected model closes the
        // socket (→ onclose → next model) instead.
        try {
          if (event.data instanceof Blob) {
            event.data.text().then(t => {
              const d = JSON.parse(t);
              if (!sawAnyServerMessage) {
                sawAnyServerMessage = true;
                activate();
                // Re-parse the first message through the normal handler
                this._handleServerMessageEvent({ data: d });
              } else {
                this._onServerMessage(d, ws);
              }
            }).catch(() => {});
          } else {
            const d = JSON.parse(event.data);
            if (!sawAnyServerMessage) {
              sawAnyServerMessage = true;
              activate();
              this._handleServerMessageEvent({ data: d });
            } else {
              this._onServerMessage(d, ws);
            }
          }
        } catch {}
      };

      ws.onerror = () => {
        // Some browsers surface onerror before onclose; wait for onclose
      };

      ws.onclose = () => {
        console.warn(`[GeminiLive] WS closed for ${model}`);
        if (this.ws === ws) {
          this.isConnected = false;
          if (this.onClose) this.onClose();
        }
        if (!settled) finish(false);
      };
    });
  }

  /** Try a chain of candidate models — the first that acks setup wins. */
  async connect() {
    try {
      this.config = await fetchGeminiLiveConfig();
      if (!this.config || !this.config.live_enabled || !this.config.api_key) {
        console.warn('[GeminiLive] Live config unavailable or missing key');
        return false;
      }

      const apiKey = this.config.api_key;
      const fallbackModels = [
        'gemini-2.5-flash-native-audio-latest',
        'gemini-2.0-flash-exp',
      ];
      // Server-configured model first (env override), then fallbacks.
      const models = [this.config.model || 'gemini-2.5-flash-native-audio-latest', ...fallbackModels];
      const seen = new Set();

      for (const model of models) {
        if (seen.has(model)) continue;
        seen.add(model);
        console.log(`[GeminiLive] Attempting Live model: ${model}`);
        const ok = await this.openSocketForModel(apiKey, model);
        if (ok) {
          console.log(`[GeminiLive] Native Voice-to-Voice active using ${model} ✓`);
          this.initAudioContext();
          return true;
        }
      }

      console.warn('[GeminiLive] All Live models failed to connect');
      return false;
    } catch (err) {
      console.warn('[GeminiLive] Connect failed:', err.message);
      return false;
    }
  }

  /** Build the setup handshake payload for the given model */
  _buildSetupPayload(model) {
    const voiceName = (this.voiceGender === 'male') ? 'Puck' : 'Aoede';
    const langMap = {
      en: 'English',
      hi: 'Hindi',
      kn: 'Kannada',
      ta: 'Tamil',
      te: 'Telugu',
      mr: 'Marathi',
      bn: 'Bengali',
      gu: 'Gujarati',
      ml: 'Malayalam',
      pa: 'Punjabi'
    };
    const activeLang = langMap[this.currentLanguage] || '';
    const langLockStr = activeLang 
      ? `\n5. STRICT LANGUAGE LOCK: The user has selected ${activeLang}. You MUST speak 100% in ${activeLang}. NEVER respond in Hindi when the user speaks in English!`
      : `\n5. STRICT LANGUAGE MATCHING: IF THE USER SPEAKS IN ENGLISH, YOU MUST RESPOND 100% IN ENGLISH. IF THE USER SPEAKS IN HINDI, RESPOND IN HINDI. NEVER DEFAULT TO HINDI WHEN ASKED IN ENGLISH!`;

    return {
      setup: {
        model: `models/${model}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          temperature: 0.3,
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voiceName
              }
            }
          }
        },
        systemInstruction: {
          parts: [
            { text: (this.config?.system_instruction || "You are JanSeva AI, an empathetic Indian Government Scheme Voice Companion.") + "\nVOICE RULES:\n1. NEVER speak or output your internal reasoning, meta-thoughts, or tool status.\n2. PURE SINGLE LANGUAGE: Speak strictly in ONE primary language matching the user's spoken input. Do NOT mix multiple languages in the same sentence.\n3. CLEAR PACED CADENCE: Speak at a warm, clear, comfortable human conversational pace. Do NOT rush or slur words.\n4. Always provide a COMPLETE 2 to 3 sentence answer." + langLockStr }
          ]
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: "search_government_schemes",
                description: "Search verified Indian government schemes by user query and state to retrieve eligibility, benefits, and application rules.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    query: { type: "STRING", description: "The scheme topic or name to search" },
                    state: { type: "STRING", description: "Indian state name or All India" }
                  },
                  required: ["query"]
                }
              }
            ]
          }
        ]
      }
    };
  }

  /** Handle an incoming server message while we are still in the ack-detection phase */
  async _onServerMessage(data, ws) {
    if (data.serverContent && data.serverContent.modelTurn?.parts) {
      for (const part of data.serverContent.modelTurn.parts) {
        if (part.text) {
          let cleaned = part.text
            .replace(/\*\*[^\*\n]+\*\*/gi, '')
            .replace(/I've (?:begun|initiated|realized)[^\.\n]*[\.\n]?/gi, '')
            .replace(/I (?:need|want|recognize)[^\.\n]*(?:finish|continue|omission)[^\.\n]*[\.\n]?/gi, '')
            .replace(/I was cut off[^\.\n]*[\.\n]?/gi, '');
          if (cleaned.trim() && this.onTextChunk) this.onTextChunk(cleaned);
        }
      }
    }
    if (data.toolCall && data.toolCall.functionCalls) {
      for (const call of data.toolCall.functionCalls) {
        if (this.onToolCall) this.onToolCall(call.name, call.args);
        if (call.name === 'search_government_schemes') {
          const query = call.args?.query || '';
          const state = call.args?.state || '';
          const facts = await executeToolSearch(query, state);
          this.sendToolResponse(call.id, call.name, { facts });
        }
      }
    }
  }

  /** Route parsed messages to the normal parser after the session is active */
  async _handleServerMessageEvent(event) {
    try {
      let data;
      if (event.data instanceof Blob) {
        const text = await event.data.text();
        data = JSON.parse(text);
      } else {
        data = JSON.parse(event.data);
      }
      await this.handleServerMessage({ data });
    } catch (err) {
      console.warn('[GeminiLive] Error parsing message:', err.message);
    }
  }

  /** Send initial setup handshake payload */
  sendSetup(model) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const voiceName = (this.voiceGender === 'male') ? 'Puck' : 'Aoede';

    const setupMsg = {
      setup: {
        model: `models/${model}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voiceName
              }
            }
          }
        },
        systemInstruction: {
          parts: [
            { text: this.config.system_instruction || "You are JanSeva AI, an empathetic Indian Government Scheme Voice Companion." }
          ]
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: "search_government_schemes",
                description: "Search verified Indian government schemes by user query and state to retrieve eligibility, benefits, and application rules.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    query: { type: "STRING", description: "The scheme topic or name to search" },
                    state: { type: "STRING", description: "Indian state name or All India" }
                  },
                  required: ["query"]
                }
              }
            ]
          }
        ]
      }
    };

    console.log(`[GeminiLive] Sending setup payload (voiceName=${voiceName})...`);
    this.ws.send(JSON.stringify(setupMsg));
  }

  /** Initialize WebAudio AudioContext for PCM output */
  async initAudioContext() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      // Request 24kHz with interactive latency hint for ultra-low latency real-time voice playback
      this.audioCtx = new AudioContextClass({ sampleRate: 24000, latencyHint: 'interactive' });
      if (this.audioCtx.state === 'suspended') {
        try { await this.audioCtx.resume(); } catch {}
      }
      this.nextStartTime = this.audioCtx.currentTime;

      // Create reference speaker analyser node for Acoustic Differential Double-Talk Detection
      this.speakerAnalyser = this.audioCtx.createAnalyser();
      this.speakerAnalyser.fftSize = 256;
      this.speakerAnalyser.connect(this.audioCtx.destination);
    } catch (e) {
      console.warn('[GeminiLive] AudioContext failed:', e.message);
    }
  }

  /** Handle incoming messages from Gemini Live server */
  async handleServerMessage(event) {
    try {
      let data = event.data;
      if (data instanceof Blob) {
        const text = await data.text();
        data = JSON.parse(text);
      } else if (typeof data === 'string') {
        data = JSON.parse(data);
      }

      // 1. Check for serverContent (audio response / text)
      if (data.serverContent) {
        const { modelTurn, turnComplete, interrupted } = data.serverContent;

        if (interrupted) {
          console.log('[GeminiLive] Gemini response interrupted by user voice');
          this.stopAudioPlayback();
          if (this.onSpeechEnd) this.onSpeechEnd();
        }

        if (modelTurn && modelTurn.parts) {
          for (const part of modelTurn.parts) {
            // Audio PCM chunk
            if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('audio/pcm')) {
              if (this.onSpeechStart) this.onSpeechStart();
              this.playPCMChunk(part.inlineData.data);
            }
            // Text transcript part
            if (part.text) {
              // Strip all internal thinking headers (e.g. **Re-Targeting...**) and meta-reasoning sentences
              let cleaned = part.text
                .replace(/\*\*[^\*\n]+\*\*/gi, '')
                .replace(/I've (?:begun|initiated|realized)[^\.\n]*[\.\n]?/gi, '')
                .replace(/I (?:need|want|recognize)[^\.\n]*(?:finish|continue|omission)[^\.\n]*[\.\n]?/gi, '')
                .replace(/I was cut off[^\.\n]*[\.\n]?/gi, '');
              if (cleaned.trim() && this.onTextChunk) this.onTextChunk(cleaned);
            }
          }
        }

        if (turnComplete) {
          console.log('[GeminiLive] Turn complete ✓');
        }
      }

      // 2. Check for toolCall (DB Search Function Call)
      if (data.toolCall) {
        const { functionCalls } = data.toolCall;
        if (functionCalls && functionCalls.length > 0) {
          for (const call of functionCalls) {
            console.log('[GeminiLive] Tool call requested:', call.name, call.args);
            if (this.onToolCall) this.onToolCall(call.name, call.args);

            if (call.name === 'search_government_schemes') {
              const query = call.args?.query || '';
              const state = call.args?.state || '';
              const facts = await executeToolSearch(query, state);

              // Send tool response back to Gemini
              this.sendToolResponse(call.id, call.name, { facts });
            }
          }
        }
      }
    } catch (err) {
      console.warn('[GeminiLive] Error parsing server message:', err.message);
    }
  }

  /** Send tool execution response back to Gemini WebSocket */
  sendToolResponse(callId, functionName, responseOutput) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const toolRespMsg = {
      toolResponse: {
        functionResponses: [
          {
            response: { output: responseOutput },
            id: callId
          }
        ]
      }
    };

    console.log('[GeminiLive] Sending tool response back to Gemini...');
    this.ws.send(JSON.stringify(toolRespMsg));
  }

  /** Base64-encode Int16 PCM and send over the Gemini WebSocket */
  sendPCMAudio(pcmInt16) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!pcmInt16 || pcmInt16.length === 0) return;

    // Convert Int16 PCM to Base64 and send over WebSocket
    const bytes = new Uint8Array(pcmInt16.buffer);
    const chunkSize = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    const base64Audio = window.btoa(binary);

    this.ws.send(JSON.stringify({
      realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm", data: base64Audio }] }
    }));
  }

  /** Decode Base64 Int16 PCM and play via WebAudio buffer queue */
  playPCMChunk(base64Data) {
    if (!this.audioCtx) return;

    try {
      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // 1. Decodes 16-bit Little-Endian PCM cleanly using DataView to prevent endian/alignment corruption
      const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const numSamples = Math.floor(len / 2);
      const float32Array = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        const sampleInt16 = dataView.getInt16(i * 2, true); // Little Endian
        float32Array[i] = sampleInt16 / 32768.0;
      }

      // 2. Use the ACTUAL AudioContext sample rate (fallback 24kHz). The Gemini
      //    Live API sends 24kHz PCM, so if the browser granted a different rate
      //    we resample so playback remains correct pitch/speed.
      const actualRate = this.audioCtx.sampleRate || 24000;
      let bufferData = float32Array;
      if (actualRate !== 24000 && actualRate > 0) {
        // Linear resample 24kHz → actualRate
        const ratio = actualRate / 24000;
        const newLen = Math.floor(float32Array.length * ratio);
        const resampled = new Float32Array(newLen);
        for (let i = 0; i < newLen; i++) {
          const originIdx = i / ratio;
          const idxFloor = Math.floor(originIdx);
          const idxCeil = Math.min(float32Array.length - 1, idxFloor + 1);
          const factor = originIdx - idxFloor;
          resampled[i] = float32Array[idxFloor] * (1 - factor) + float32Array[idxCeil] * factor;
        }
        bufferData = resampled;
      }

      const buffer = this.audioCtx.createBuffer(1, bufferData.length, actualRate);
      buffer.getChannelData(0).set(bufferData);

      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;

      // Connect source through speakerAnalyser for reference energy tracking
      if (this.speakerAnalyser) {
        source.connect(this.speakerAnalyser);
      } else {
        source.connect(this.audioCtx.destination);
      }

      const now = this.audioCtx.currentTime;
      if (this.nextStartTime < now + 0.04) {
        this.nextStartTime = now + 0.04; // 40ms smooth initial buffer to prevent start crackle
      }

      if (this.speechEndTimer) {
        clearTimeout(this.speechEndTimer);
        this.speechEndTimer = null;
      }

      source.start(this.nextStartTime);
      this.nextStartTime += buffer.duration;
      this.activeSources.push(source);

      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx !== -1) this.activeSources.splice(idx, 1);
        if (this.activeSources.length === 0) {
          if (this.speechEndTimer) clearTimeout(this.speechEndTimer);
          this.speechEndTimer = setTimeout(() => {
            if (this.activeSources.length === 0 && this.onSpeechEnd) {
              this.onSpeechEnd();
            }
          }, 350);
        }
      };
    } catch (e) {
      console.warn('[GeminiLive] PCM playback decode error:', e.message);
    }
  }

  /** Start streaming microphone audio to Gemini (resampled to 16kHz Int16 PCM) */
  async startMicStreaming() {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const micAudioCtx = new AudioContextClass();
      this.micAudioCtx = micAudioCtx;

      // CRITICAL: A fresh AudioContext starts SUSPENDED (autoplay policy).
      // If it stays suspended, the AudioWorklet never fires → zero mic frames
      // are sent → "it's not taking my voice input" even though the WebSocket
      // is connected. Resume aggressively; deferred resume is retried after
      // the worklet is wired (best effort) as well.
      let resumed = false;
      if (micAudioCtx.state === 'suspended') {
        try {
          await micAudioCtx.resume();
          resumed = micAudioCtx.state === 'running';
        } catch (resumeErr) {
          console.warn('[GeminiLive] Initial mic AudioContext resume failed:', resumeErr.message);
        }
      } else {
        resumed = true;
      }
      if (!resumed) {
        // Retry resume shortly — some browsers allow it once user gesture
        // propagates through the promise chain.
        setTimeout(() => {
          try {
            if (micAudioCtx && micAudioCtx.state === 'suspended') micAudioCtx.resume();
          } catch {}
        }, 250);
      }
      console.log(`[GeminiLive] Mic AudioContext state: ${micAudioCtx.state} (resumed=${resumed})`);

      const source = micAudioCtx.createMediaStreamSource(this.micStream);
      const nativeSampleRate = micAudioCtx.sampleRate || 48000;
      console.log(`[GeminiLive] Mic sample rate: ${nativeSampleRate}Hz → Resampling to 16000Hz PCM ✓`);

      let bargeInSpikes = 0;

      const handleAudioFrame = (float32Data) => {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const { pcmInt16, rms: micRMS } = processAndResamplePCM(float32Data, nativeSampleRate);
        if (!pcmInt16 || pcmInt16.length === 0) return;

        // ⚡ ACOUSTIC DIFFERENTIAL DOUBLE-TALK DETECTOR (ADTD):
        // Measure real-time speaker output level directly from WebAudio graph
        let speakerRMS = 0;
        if (this.speakerAnalyser && this.activeSources.length > 0) {
          const speakerTimeData = new Float32Array(this.speakerAnalyser.fftSize);
          this.speakerAnalyser.getFloatTimeDomainData(speakerTimeData);
          let sSum = 0;
          for (let i = 0; i < speakerTimeData.length; i++) {
            sSum += speakerTimeData[i] * speakerTimeData[i];
          }
          speakerRMS = Math.sqrt(sSum / speakerTimeData.length);
        }

        // When AI is actively speaking through speakers:
        if (this.activeSources.length > 0) {
          // Genuine user barge-in requires mic level to significantly exceed speaker output
          if (micRMS > 0.16 && micRMS > speakerRMS * 1.5) {
            bargeInSpikes++;
            if (bargeInSpikes >= 3) {
              console.log(`[GeminiLive ADTD] User voice interrupted AI! (micRMS=${micRMS.toFixed(3)}, speakerRMS=${speakerRMS.toFixed(3)})`);
              this.stopAudioPlayback();
              if (this.onSpeechEnd) this.onSpeechEnd();
              this.sendPCMAudio(pcmInt16);
            }
          } else {
            bargeInSpikes = 0;
            // CRITICAL: Suppress mic audio sending while AI is speaking so speaker audio
            // is NEVER fed back to Gemini. This prevents Gemini from self-interrupting mid-sentence!
          }
          return;
        }

        // Normal listening mode (AI is quiet): reset spikes and send mic audio to Gemini
        bargeInSpikes = 0;
        this.sendPCMAudio(pcmInt16);
      };

      if (micAudioCtx.audioWorklet) {
        const blob = new Blob([PCM_WORKLET_CODE], { type: 'application/javascript' });
        const workletUrl = URL.createObjectURL(blob);
        await micAudioCtx.audioWorklet.addModule(workletUrl);
        URL.revokeObjectURL(workletUrl);

        const workletNode = new AudioWorkletNode(micAudioCtx, 'pcm-processor');
        workletNode.port.onmessage = (e) => {
          const float32Data = new Float32Array(e.data);
          handleAudioFrame(float32Data);
        };

        const dummyGain = micAudioCtx.createGain();
        dummyGain.gain.value = 0;
        source.connect(workletNode);
        workletNode.connect(dummyGain);
        dummyGain.connect(micAudioCtx.destination);

        this.audioWorkletNode = workletNode;
        console.log('[GeminiLive] Microphone streaming via AudioWorkletNode (resampled 16kHz PCM) ✓');
      } else {
        const processor = micAudioCtx.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          handleAudioFrame(inputData);
        };

        source.connect(processor);
        processor.connect(micAudioCtx.destination);
        this.scriptProcessor = processor;
        console.log('[GeminiLive] Microphone streaming via ScriptProcessorNode fallback (resampled 16kHz PCM) ✓');
      }
    } catch (err) {
      console.warn('[GeminiLive] Mic streaming error:', err.message);
      // Notify the modal so it can drop Live mode and fall back to the Groq
      // STT path. Without this, Live stays "connected" with no mic → the user
      // is stuck with a dead assistant.
      this.disconnect();
      this.onMicError(err?.message || 'Microphone unavailable');
    }
  }

  /** Stop active audio playback immediately */
  stopAudioPlayback() {
    // 4. Cancel SpeechSynthesis & stop active BufferSource nodes
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch {}
    this.activeSources.forEach(src => {
      try { src.stop(); } catch {}
    });
    this.activeSources = [];
    if (this.audioCtx) {
      this.nextStartTime = this.audioCtx.currentTime;
    }
  }

  /** Disconnect and cleanup all resources */
  disconnect() {
    console.log('[GeminiLive] Cleaning up live session...');
    this.isConnected = false;

    this.stopAudioPlayback();

    if (this.audioWorkletNode) {
      try { this.audioWorkletNode.disconnect(); } catch {}
      this.audioWorkletNode = null;
    }

    if (this.scriptProcessor) {
      try { this.scriptProcessor.disconnect(); } catch {}
      this.scriptProcessor = null;
    }

    if (this.micStream) {
      try { this.micStream.getTracks().forEach(t => t.stop()); } catch {}
      this.micStream = null;
    }

    // 2. In disconnect(), close micAudioCtx
    if (this.micAudioCtx) {
      try { this.micAudioCtx.close(); } catch {}
      this.micAudioCtx = null;
    }

    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch {}
      this.audioCtx = null;
    }

    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}