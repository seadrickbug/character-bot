import dotenv from "dotenv";
import OpenAI from "openai";
import { createApp } from "./app.js";

dotenv.config({ path: new URL("../.env", import.meta.url) });

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is missing from backend/.env");
}

const port = Number(process.env.PORT) || 3000;
const model = process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";
const speechModel = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const speechVoice = process.env.OPENAI_TTS_VOICE || "marin";
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = createApp({ openaiClient, model, speechModel, speechVoice });

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
