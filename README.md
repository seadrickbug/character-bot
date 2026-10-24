# Talking Buddy

Create a temporary fictional character with a generated personality and voice, then chat with it in text and speech.

## Current flow

1. Choose an original character prompt or enter a known fictional character.
2. The API generates a structured personality, conversation style, avatar prompt, and compatible Kokoro voice profile.
3. The profile is stored in a temporary SQLite session and shown for review.
4. Chat responses are guided by the stored profile and spoken with its voice settings.
5. Ending or leaving the session deletes the profile. Inactive sessions expire after 30 minutes, and chat messages are never written to the database.

## Run locally

Add the following settings to `backend/.env` (`PORT` is optional):

```env
OPENAI_API_KEY=your_api_key
OPENAI_CHAT_MODEL=gpt-5-nano-2025-08-07
KOKORO_MODEL_ID=onnx-community/Kokoro-82M-v1.0-ONNX
KOKORO_VOICE=af_heart
KOKORO_DTYPE=q8
KOKORO_DEVICE=cpu
KOKORO_SPEED=1
HOST=127.0.0.1
PORT=3000
SQLITE_PATH=../data/character-sessions.db
```

Then run the API and frontend in separate terminals:

```sh
cd backend/api
npm run dev
```

```sh
cd frontend/Character-web
npm run dev
```

`SQLITE_PATH` is optional. By default, the database is created at
`backend/data/character-sessions.db`; database files are ignored by Git.

The frontend uses `/api/chat/stream` for a newline-delimited event stream. Model
text is displayed token by token, complete sentences are queued for speech, and
24 kHz PCM audio is played through Web Audio as chunks arrive. Message replay
uses the same streaming audio path through `/api/speech/stream`. Vite proxies
both endpoints to the API at `http://localhost:3000`.

Speech is generated locally with Kokoro-82M. On the first backend start,
`kokoro-js` downloads the selected ONNX model from Hugging Face and caches it;
later starts reuse the cached model. The voice heard in the interface is
AI-generated.

Character profile and chat requests use the OpenAI Responses API with storage
disabled. Known-character generation accepts fictional characters only and uses
generic voice direction rather than imitating a real actor.
