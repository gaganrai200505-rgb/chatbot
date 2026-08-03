# JanSeva AI — Voice-to-Voice Transformation Strategy
## Target: ChatGPT Advanced Voice Mode Parity

---

## Executive Summary

The current `SiriVoiceModal` operates as a **sequential ASR → LLM → TTS pipeline** with three distinct network hops, browser-side VAD, and post-hoc echo suppression. To reach ChatGPT Advanced Voice Mode parity, this document outlines a phased transformation to a **direct voice-to-voice architecture** targeting < 300 ms end-to-end latency, robust acoustic barge-in, pan-Indian linguistic coverage, and human-like conversational turn-taking.

---

## 1. Current Architecture Audit

### 1.1 Frontend Pipeline (`frontend/src/SiriVoiceModal.jsx`)

| Stage | Implementation | Latency | Issues |
|-------|---------------|---------|--------|
| **STT (PATH A)** | Groq Whisper via MediaRecorder (250 ms chunks) + client-side VAD (850 ms silence gate) | 1.1–4.0 s | 4 s hard cutoff; echo can leak into transcript before guard fires |
| **STT (PATH B)** | Web Speech API (`webkitSpeechRecognition`) | 0.8–2.0 s | Chrome-only; no native support for most regional scripts; intermittent `onend` re-entrancy |
| **LLM** | Groq streaming (`llama-3.1-8b-instant` → `gemma2-9b-it`) | 0.5–2.0 s | Good; already streaming |
| **TTS** | Edge-TTS (MP3 blob) → `<audio>` element | 0.8–3.0 s | Non-streaming; entire audio must download before playback starts |
| **Echo Guard** | Jaccard word-overlap (≥ 0.55) + 4 s post-speech suppression window | N/A | Misses paraphrased echoes; window is either fully open or fully closed |
| **Barge-in** | AudioContext analyser polling (60 ms) while AI speaks | 60 ms | Detached from VAD; competes for mic access; no acoustic echo cancellation (AEC) guarantees |

### 1.2 Backend Pipeline (`backend/chatbot/views.py`, `rag_pipeline.py`)

| Stage | Implementation | Latency | Issues |
|-------|---------------|---------|--------|
| **RAG / Retrieval** | FAISS with `HashingVectorizer` (Numpy fallback) | ~50 ms | `HashingVectorizer` produces random-feature embeddings; poor semantic recall vs. `sentence-transformers` |
| **LLM Inference** | Groq API with model failover | 0.5–2.0 s | Acceptable for streaming |
| **TTS Synthesis** | Edge-TTS async generation (server-side) | 0.5–2.0 s | Blocks a worker thread; no streaming audio chunks sent to client |
| **Translation** | `deep_translator.GoogleTranslator` | 300–800 ms | Synchronous HTTP round-trip; added on every non-English response |

### 1.3 Root-Cause Latency Breakdown

```
User speaks → [VAD silence 850ms] → [Groq STT 600ms] → [LLM first token 400ms] → [TTS synthesis 1200ms] → [Audio download 800ms] → [Playback starts]
Total worst-case: ~4.5 s (unacceptable for real-time conversation)
```

---

## 2. Strategic Objectives

| Objective | Target Metric | Current Baseline |
|-----------|--------------|------------------|
| **End-to-End Latency** | < 300 ms (AI response start after user stops) | ~2.5–4.5 s |
| **Barge-in Detection** | < 100 ms; 0 false positives on own-voice | ~60 ms poll; occasional self-trigger |
| **Language Coverage** | 10+ Indian languages + English with native-quality TTS | 10 langs; TTS only via Edge/Sarvam; STT via Groq |
| **Conversational Fluidity** | Sub-300 ms inter-turn gap; natural turn-taking | 1–2 s gaps; hard turn boundaries |

---

## 3. Pillar 1 — Latency & Fluidity Optimization

### 3.1 Adopt Streaming TTS with Playback-While-Buffering

**Problem:** Current TTS downloads the entire MP3 before `<audio>` can play.

**Fix:**
- Backend: Replace single-blob Edge-TTS response with **chunked streaming TTS**.
  - Use `edge_tts.Communicate.stream()` to yield PCM/Opus chunks as they are synthesized.
  - Wrap in Django `StreamingHttpResponse` with `Content-Type: audio/webm; codecs=opus`.
  - Send chunks in 200–400 ms windows.
- Frontend:
  - Use `MediaSource` API + `SourceBuffer` to append chunks and start playback after the first 200 ms buffer.
  - Eliminates the "wait for full synthesis" bottleneck.
  - **Expected gain:** 800–1200 ms reduction in TTS start time.

### 3.2 Parallelize the Inference Pipeline

**Fix:**
- Start TTS synthesis **as soon as the first LLM token arrives** (or even pre-synthesize common conversational fillers like "Haan", "Tell me more", "Okay" based on predicted intent).
- Implement a **token-to-audio lookahead scheduler**:
  - While streaming tokens, maintain a 1–2 sentence buffer.
  - Kick off TTS on the completed buffer, overlap with next token batch.
- **Expected gain:** 300–500 ms reduction via concurrent execution.

### 3.3 Client-Side Token Chunking for Early TTS Trigger

**Fix:**
- In `sendChatMessageStream`, trigger `speakAnswer` not only on `onComplete` but also on **interim chunks** when the accumulated text forms a complete sentence (detected via `.` / `!` / `?` / regional sentence terminators like `।`, `?`).
- This enables **incremental TTS** during LLM streaming.
- **Expected gain:** 200–400 ms perceived latency reduction.

### 3.4 Replace HashingVectorizer with Real Embeddings

**Fix:**
- `embeddings.py` currently uses `sklearn.feature_extraction.text.HashingVectorizer` as a "bypass" because `sentence-transformers` was hanging.
- Root-cause fix: The hang is likely due to PyTorch/TensorFlow import on Render free-tier (memory pressure).
- Replace with **ONNX Runtime + `all-MiniLM-L6-v2` (quantized)**:
  - Load via `optimum[onnxruntime]` or `onnxruntime` directly.
  - Quantized model is ~25 MB, runs in < 50 ms on CPU, no torch dependency.
  - Dramatically improves FAISS recall quality.
- **Expected gain:** Better RAG accuracy → fewer web-search fallbacks → shorter LLM prompts → faster inference.

### 3.5 Optimize Translation Pipeline

**Fix:**
- For voice mode, require the **LLM to output in the target language natively** (already partially done via `_build_voice_companion_prompt`).
- Remove the synchronous `translate_from_english` call from the streaming voice path in `views.py`.
- Only translate in text/chat mode where latency is less critical.
- **Expected gain:** 300–800 ms reduction per turn.

---

## 4. Pillar 2 — Acoustic Robustness & Barge-in

### 4.1 Fix EchoGuard False Negatives

**Problem:** EchoGuard relies on exact-word Jaccard similarity. Paraphrased or partially-captured AI speech bypasses it.

**Fix:**
- Replace Jaccard with **cross-encoder semantic similarity** using a lightweight model (e.g., `cross-encoder/ms-marco-MiniLM-L-6-v2` ONNX).
  - Run client-side in WebAssembly (`transformers.js`) or on the backend via a lightweight endpoint.
  - Threshold: > 0.75 similarity = echo.
- Add **speaker diarization heuristics**:
  - Compare RMS energy profile of current transcript segment vs. last AI utterance's estimated energy envelope.
  - If energy profiles correlate strongly (> 0.80 Pearson), suppress as echo.
- **Expected gain:** Near-zero false-negative echo rate.

### 4.2 Unify VAD and Barge-in into a Single Acoustic State Machine

**Problem:** VAD runs in `startListening` (Groq path) and barge-in runs in `startBargeInMicListener`. They compete for mic access and `AudioContext` nodes.

**Fix:**
- Implement a **single unified AudioGraph** that stays alive for the entire modal session:
  ```js
  MicStream → GainNode → AnalyserNode → [VAD Processor]
                              → [Barge-in Detector] (when isSpeaking)
                              → [Silence Gate Recorder] (when listening)
  ```
- Use a **state machine** with states: `IDLE` → `LISTENING` → `PROCESSING` → `SPEAKING` → `BARGE_IN_DETECTED`.
- Transitions:
  - `SPEAKING` → if `isSpeaking && !gracePeriod && bargeEnergy > threshold_for_N_consecutive_polls` → `BARGE_IN_DETECTED` → `LISTENING`.
  - `LISTENING` → if `silence > 600ms` → submit STT.
- Close the `AudioContext` **never** during the session; only suspend/resume tracks.
- **Expected gain:** Eliminates mic re-acquisition lag (~200 ms); zero race conditions.

### 4.3 Hardware-Accelerated AEC via `AudioWorklet`

**Problem:** Browser's built-in `echoCancellation: true` is a generic DSP that often fails on full-duplex voice loops (speaker → mic).

**Fix:**
- Implement a custom `AudioWorklet` processor that performs **adaptive filter AEC** (NLMS algorithm) on the PCM stream.
  - Input 1: microphone samples.
  - Input 2: reference audio (what the AI is playing) routed via `MediaStreamTrackProcessor` + `AudioWorklet`.
  - Output: echo-cancelled microphone samples.
- Fallback: If `AudioWorklet` is unavailable, use the browser AEC but increase `bargeIn` grace period to 1.2 s and add a **spectral subtraction** post-filter.
- **Expected gain:** 60–80 % reduction in own-voice leakage into STT.

### 4.4 Neural VAD Model

**Fix:**
- Replace heuristic VAD (threshold on `maxVal`/`avg`) with **Silero VAD** (`silero-vad` ONNX).
  - Runs at 100–200 Hz frame rate.
  - Robust to noise, accents, and soft speech.
  - Outputs speech probability per frame.
- Client-side via WebAssembly (e.g., `@ricky0123/vad-web`) or server-side via a lightweight WebSocket endpoint.
- **Expected gain:** 90 %+ speech detection accuracy; eliminates 850 ms silence tuning.

---

## 5. Pillar 3 — Linguistic Versatility

### 5.1 Unified Multilingual STT Strategy

**Current:** Groq Whisper supports all 10 languages. Web Speech API does not.

**Fix:**
- **Make Groq Whisper the primary STT for ALL languages**, not just `en`/`hi`/`mr`/`auto`.
- Remove the `GROQ_STT_LANGS` gate in `startListening`. Always use the MediaRecorder + Groq path.
- Configure Whisper with `language` parameter per detected locale and a **domain-specific prompt** tuned for government scheme vocabulary in each language.
- **Expected gain:** Consistent STT quality across all 10+ languages; eliminates flaky WebSpeech fallback.

### 5.2 Native Multilingual TTS

**Fix:**
- Expand Edge-TTS voice map to cover all requested regional languages with **neural female + male pairs** (already partially done in `views.py`).
- Add **Sarvam AI bulbul:v1** as primary TTS for South Indian languages (Tamil, Telugu, Kannada, Malayalam) where Edge-TTS voices show lower prosodic naturalness.
  - Sarvam offers `kavya` (Tamil), `shruti` (Telugu), `sapna` (Kannada), `sobhana` (Malayalam) — all with better rhythm for Dravidian phonology.
- For Hindi + English Hinglish code-mixing, use **Edge-TTS `en-IN-NeerjaNeural`** with `prosody` tags for seamless code-switching.
- **Expected gain:** Higher perceived naturalness in regional languages; reduced need for post-hoc translation.

### 5.3 End-to-End Language Consistency

**Fix:**
- In `_build_voice_companion_prompt`, enforce **strict language adherence** via LLM system instructions:
  - "You MUST respond in the user's detected language. If the user mixes languages, mirror their code-switching pattern."
- Remove the backend `translate_from_english` call from the voice streaming path entirely. Trust the LLM to output in the correct language.
- **Expected gain:** Eliminates translation latency and "translationese" artifacts.

---

## 6. Pillar 4 — System Architecture: Direct Voice-to-Voice

### 6.1 Migrate to Gemini 2.0 Multimodal Live Voice API

**Current State:** `GeminiLiveConfigView` and `SearchSchemesToolView` exist but are **not wired to the frontend**. The frontend still uses the old Groq STT → Groq LLM → Edge-TTS path.

**Architecture:**

```
┌──────────────────────────────────────────────────────────────────┐
│                    Unified Voice Session (WebSocket)             │
│                                                                  │
│  Client (SiriVoiceModal)          Backend (Django + Gemini)      │
│  ┌──────────────┐                ┌──────────────────────────┐   │
│  │ Mic Stream   │──PCM/Opus────▶│ Gemini 2.0 Live API      │   │
│  │ (16kHz mono) │               │ (multimodal audio+text)  │   │
│  └──────────────┘                └──────────┬───────────────┘   │
│                                             │ tool calls        │
│                                             ▼                   │
│  ┌──────────────┐                ┌──────────────────────────┐   │
│  │ Speaker      │◀──PCM/Opus────│ TTS Relay / Passthrough  │   │
│  │ (AudioContext)│               │ (if native audio output) │   │
│  └──────────────┘                └──────────────────────────┘   │
│                                                                  │
│  Barge-in: ◀── client detects ──▶ sends `INTERRUPT` signal ──▶  │
│            Gemini aborts current generation, accepts new audio  │
└──────────────────────────────────────────────────────────────────┘
```

**Implementation Steps:**

1. **Backend:**
   - Add a `GeminiLiveSessionView` that proxies WebSocket connections to `generativelanguage.googleapis.com`.
   - Manage session lifecycle, tool definitions (`search_government_schemes`), and auth.
   - Reuse existing `SearchSchemesToolView` logic inside the WebSocket tool handler.

2. **Frontend:**
   - Replace the current STT/LLM/TTS orchestration with a **single WebSocket client**.
   - Stream raw PCM audio (16 kHz, mono, Float32) to the backend.
   - Receive native audio responses from Gemini and play them via `AudioContext` + `AudioWorklet`.
   - **Barge-in:** When the client detects user speech above threshold, it immediately sends an `INTERRUPT` frame. Gemini aborts generation, resets context, and begins listening again.

3. **Fallback Path:**
   - If Gemini Live API quota/cost is prohibitive, retain the current Groq pipeline as a **graceful degradation** mode.

### 6.2 Prosody & Turn-Taking Control

**Fix:**
- Inject **conversation markers** into the LLM prompt to control turn structure:
  - `[TURN_END]` markers to signal when the AI has finished its conversational move.
  - `[BACKCHANNEL]` markers for acknowledgments ("Haan", "Okay", "Tell me more").
  - Prompt the model to **end every response with a short question** (already partially done in `_build_voice_companion_prompt`).
- Use **endpointing logic**:
  - If AI response ends with a question mark or `[TURN_END]`, immediately open the mic (no extra delay).
  - If AI response ends with a statement, insert a 150 ms "thinking" pause before opening the mic (mimics human listening).

### 6.3 Audio Pipeline Optimization

**Fix:**
- Use **Opus codec** (`audio/ogg; codecs=opus`) for all client→server audio. Opus at 16 kHz mono is ~12 kbps — lower latency than WebM/MP3.
- Implement **jitter buffer** on the backend to smooth network variability without adding perceptible delay.
- Pre-warm the Gemini session with a **"hello" priming audio frame** when the modal opens, so the first real response benefits from an already-established WebSocket.

---

## 7. Implementation Roadmap

| Phase | Duration | Focus | Key Deliverables |
|-------|----------|-------|------------------|
| **Phase 1** | 1–2 weeks | Quick Wins | Streaming TTS; incremental TTS trigger; remove redundant translation in voice path; replace HashingVectorizer with ONNX MiniLM |
| **Phase 2** | 2–3 weeks | Acoustic Hardening | Silero VAD integration; unified AudioGraph state machine; improved EchoGuard with semantic similarity; AudioWorklet AEC |
| **Phase 3** | 3–4 weeks | Architecture Migration | Gemini 2.0 Live WebSocket proxy; frontend WebSocket audio streaming; barge-in via interrupt frames; Opus codec pipeline |
| **Phase 4** | 1–2 weeks | Polish | Sarvam TTS for South Indian languages; prosody tuning; fallback to Groq pipeline; benchmark suite |

---

## 8. Performance Targets & Validation

| Metric | Target | Measurement |
|--------|--------|-------------|
| **AI Response Start (after user stop)** | < 300 ms | `performance.now()` deltas in `SiriVoiceModal` |
| **Barge-in Detection** | < 100 ms | Time from user speech to audio interruption |
| **Echo False Positive Rate** | < 1 % | Log analysis of `isEcho` triggers |
| **Word Error Rate (STT)** | < 8 % across all 10 languages | Groq Whisper benchmark on held-out test set |
| **MOS (TTS Naturalness)** | > 4.0 / 5.0 | Listening test with 20+ native speakers per language |
| **Inter-turn Gap** | < 400 ms | Time from AI audio end to user speech detection |

---

## 9. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| **Gemini Live API cost/quota** | Implement aggressive caching of common TTS phrases; fallback to Groq pipeline when quota exhausted. |
| **WebAssembly model size** | Use quantized ONNX models (< 30 MB); lazy-load only when voice modal opens. |
| **Browser compatibility** | Graceful degradation: WebSocket → SSE → polling; AudioWorklet → AudioContext; WASM → CPU fallback. |
| **Render free-tier cold starts** | Keep-alive pings (already implemented); move TTS/STT heavy lifting to client-side WASM where possible. |

---

## 10. Conclusion

The transformation from a sequential ASR-LLM-TTS pipeline to a **unified, low-latency voice-to-voice system** requires:

1. **Streaming everything** — TTS chunks, LLM tokens, and audio frames must flow in parallel.
2. **Fusing VAD + barge-in + AEC** into one acoustic pipeline to eliminate mic-competition race conditions.
3. **Native multilingual generation** — stop translating and start prompting in the target language.
4. **Adopting a multimodal live model** (Gemini 2.0) as the single inference endpoint, collapsing three API calls into one.

Executing this roadmap will bring JanSeva AI's voice experience within striking distance of ChatGPT Advanced Voice Mode: natural, interruptible, and responsive.
