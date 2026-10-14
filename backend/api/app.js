import express from "express";

const allowedRoles = new Set(["user", "assistant", "developer", "system"]);

const normalizeHistory = (history) =>
  history.map(({ role, message }) => ({
    role: role === "model" ? "assistant" : role,
    content: message.trim(),
  }));

const isValidHistory = (history) =>
  Array.isArray(history) &&
  history.length > 0 &&
  history.every(
    (item) =>
      item &&
      typeof item.message === "string" &&
      item.message.trim() &&
      allowedRoles.has(item.role === "model" ? "assistant" : item.role),
  );

export const createApp = ({
  openaiClient,
  model,
  speechModel = "gpt-4o-mini-tts",
  speechVoice = "marin",
}) => {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.get("/", (req, res) => {
    res.send("Hello from the API!");
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Backend API is connected" });
  });

  app.post("/api/chat", async (req, res) => {
    const { history } = req.body ?? {};

    if (!isValidHistory(history)) {
      return res.status(400).json({
        error: { message: "History must contain at least one valid chat message." },
      });
    }

    try {
      const response = await openaiClient.responses.create({
        model,
        input: normalizeHistory(history),
      });
      const message = response.output_text?.trim();

      if (!message) {
        throw new Error("OpenAI returned an empty response.");
      }

      return res.json({ message });
    } catch (error) {
      console.error("OpenAI request failed:", error.message);
      return res.status(502).json({
        error: { message: "The chatbot service is temporarily unavailable." },
      });
    }
  });

  app.post("/api/speech", async (req, res) => {
    const text = req.body?.text?.trim();

    if (!text || text.length > 4096) {
      return res.status(400).json({
        error: { message: "Speech text must be between 1 and 4096 characters." },
      });
    }

    try {
      const speech = await openaiClient.audio.speech.create({
        model: speechModel,
        voice: speechVoice,
        input: text,
        instructions: "Speak naturally in a warm, conversational tone.",
        response_format: "mp3",
      });
      const audio = Buffer.from(await speech.arrayBuffer());

      res.set({
        "Content-Type": "audio/mpeg",
        "Content-Length": audio.length,
        "Cache-Control": "no-store",
      });

      return res.send(audio);
    } catch (error) {
      console.error("Speech generation failed:", error.message);
      return res.status(502).json({
        error: { message: "Speech generation is temporarily unavailable." },
      });
    }
  });

  return app;
};
