# Enhancement: Local GPU Voice Stack (RTX 5060)

Goal: Replace fragile cloud voice dependencies with local STT/TTS for lower latency and higher reliability.

## Why

- Avoid Hugging Face auth/endpoint failures during demos.
- Keep voice features working offline or on weak internet.
- Improve privacy by processing audio locally.
- Use RTX 5060 for faster inference.

## Target Architecture

- App UI keeps current voice UX (Voice + Speak buttons).
- Next.js API layer proxies to local services:
  - `POST /api/stt` -> local STT service
  - `POST /api/tts` -> local TTS service
- Browser STT/TTS remains as fallback.

## STT Plan (local)

- Use `faster-whisper` with model `tiny` first.
- Run Python FastAPI service at `http://127.0.0.1:8001`.
- Endpoint:
  - `POST /transcribe` (multipart audio)
  - Returns `{ "text": "..." }`
- Settings:
  - `device="cuda"`
  - `compute_type="float16"` (fallback to `int8` if VRAM issues)

## TTS Plan (local)

- Start with `piper` for speed and stability.
- Run service at `http://127.0.0.1:8002`.
- Endpoint:
  - `POST /speak` with `{ "text": "..." }`
  - Returns `audio/wav` stream
- Optional upgrade later: Coqui XTTS for better voice quality.

## Env Variables to Add

- `STT_PROVIDER=local` (or `browser`)
- `LOCAL_STT_URL=http://127.0.0.1:8001/transcribe`
- `TTS_PROVIDER=local` (or `browser`)
- `LOCAL_TTS_URL=http://127.0.0.1:8002/speak`

## Rollout Steps

1. Build local STT service and verify transcript quality.
2. Build local TTS service and verify playback.
3. Wire Next.js routes to local services.
4. Keep browser fallback for resilience.
5. Add health checks and clear error messages in UI.
6. Add startup scripts for Windows (PowerShell).

## Done Criteria

- Voice input works without external API keys.
- Assistant responses can be spoken from local TTS.
- Cold start under acceptable limit for demo use.
- Graceful fallback to browser voice if local service is down.

## Notes

- Start simple and stable first (`tiny` STT + Piper TTS), then tune quality.
- Delete this file after implementation is completed.
