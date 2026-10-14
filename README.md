# character-bot
Turning pictures into AI characters with their own personality

## Run locally

Add the following settings to `backend/.env` (`PORT` is optional):

```env
OPENAI_API_KEY=your_api_key
OPENAI_CHAT_MODEL=gpt-5-nano-2025-08-07
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=marin
PORT=3000
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

The frontend sends chatbot requests to `/api/chat` and text-to-speech requests to
`/api/speech`; Vite proxies both to the API at `http://localhost:3000`. The voice
heard in the interface is AI-generated.
