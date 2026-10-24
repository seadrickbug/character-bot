import dotenv from "dotenv";
import OpenAI from "openai";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createKokoroSpeechEngine } from "./kokoro.js";
import { SessionStore } from "./session-store.js";

dotenv.config({ path: new URL("../.env", import.meta.url) });

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is missing from backend/.env");
}

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";
const model = process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const databasePath = process.env.SQLITE_PATH
  || fileURLToPath(new URL("../data/character-sessions.db", import.meta.url));
const sessionStore = new SessionStore({ filename: databasePath });
sessionStore.cleanupExpired();
const speechEngine = createKokoroSpeechEngine({
  modelId: process.env.KOKORO_MODEL_ID || "onnx-community/Kokoro-82M-v1.0-ONNX",
  voice: process.env.KOKORO_VOICE || "af_heart",
  dtype: process.env.KOKORO_DTYPE || "q8",
  device: process.env.KOKORO_DEVICE || "cpu",
  speed: Number(process.env.KOKORO_SPEED) || 1,
});
const app = createApp({ openaiClient, model, speechEngine, sessionStore });

const cleanupTimer = setInterval(() => sessionStore.cleanupExpired(), 5 * 60 * 1000);
cleanupTimer.unref();

const server = app.listen(port, host, () => {
  console.log(`Server is running on http://${host}:${port}`);
  console.log(`Speech engine: Kokoro-82M (${speechEngine.voice})`);
});

server.on("error", (error) => {
  console.error("Backend server failed:", error.message);
  process.exitCode = 1;
});

speechEngine.warmup()
  .then(() => console.log("Kokoro speech model is ready."))
  .catch((error) => console.error("Kokoro model failed to load:", error.message));
