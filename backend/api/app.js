import express from "express";
import {
  buildCharacterInstruction,
  generateCharacterProfile,
} from "./character-profile.js";

const allowedRoles = new Set(["user", "model"]);

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
      allowedRoles.has(item.role),
  );

const isValidSessionId = (sessionId) =>
  typeof sessionId === "string" &&
  sessionId.length >= 32 &&
  sessionId.length <= 64 &&
  /^[a-zA-Z0-9-]+$/.test(sessionId);

const validateCharacterInput = ({ inputType, input, sourceWork }) => {
  if (!new Set(["prompt", "known"]).has(inputType)) {
    return "Choose either an original prompt or a known fictional character.";
  }

  if (typeof input !== "string" || input.trim().length < 3 || input.trim().length > 1500) {
    return "Character input must be between 3 and 1500 characters.";
  }

  if (sourceWork !== undefined && (typeof sourceWork !== "string" || sourceWork.trim().length > 120)) {
    return "Source work must be 120 characters or fewer.";
  }

  return null;
};

const setStreamingHeaders = (res) => {
  res.set({
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
};

const writeStreamEvent = (res, event) => {
  if (!res.writableEnded && !res.destroyed) {
    res.write(`${JSON.stringify(event)}\n`);
  }
};

const createSentenceChunker = (onSentence) => {
  let pending = "";
  const boundary = /([.!?]+(?:["'”’\])}]+)?)(\s+)/g;

  return {
    push(delta) {
      pending += delta;
      let consumed = 0;
      let match;

      while ((match = boundary.exec(pending)) !== null) {
        const sentenceEnd = match.index + match[1].length;
        const sentence = pending.slice(consumed, sentenceEnd).trim();
        if (sentence) onSentence(sentence);
        consumed = match.index + match[0].length;
      }

      pending = pending.slice(consumed);
      boundary.lastIndex = 0;
    },
    flush() {
      const sentence = pending.trim();
      pending = "";
      if (sentence) onSentence(sentence);
    },
  };
};

const streamSpeechAudio = async ({
  speechEngine,
  text,
  signal,
  onChunk,
  voice,
  speed,
}) => {
  if (!speechEngine) throw new Error("The speech engine is not configured.");
  await speechEngine.stream({ text, signal, onChunk, voice, speed });
};

const pcmToWav = (chunks, sampleRate) => {
  const pcm = Buffer.concat(chunks);
  const wav = Buffer.allocUnsafe(44 + pcm.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
};

export const createApp = ({
  openaiClient,
  model,
  speechEngine,
  sessionStore,
}) => {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.get("/", (req, res) => {
    res.send("Hello from the API!");
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Backend API is connected" });
  });

  const getActiveCharacter = (sessionId) => {
    if (!sessionStore || !isValidSessionId(sessionId)) return null;
    return sessionStore.getCharacter(sessionId);
  };

  const sendExpiredSession = (res) => res.status(410).json({
    error: {
      code: "session_expired",
      message: "This character session has ended. Create a new character to continue.",
    },
  });

  app.post("/api/characters", async (req, res) => {
    const inputType = req.body?.inputType;
    const rawInput = req.body?.input;
    const rawSourceWork = req.body?.sourceWork;
    const validationError = validateCharacterInput({
      inputType,
      input: rawInput,
      sourceWork: rawSourceWork,
    });

    if (validationError) {
      return res.status(400).json({ error: { message: validationError } });
    }

    const input = rawInput.trim();
    const sourceWork = rawSourceWork?.trim() || "";

    try {
      const profile = await generateCharacterProfile({
        openaiClient,
        model,
        inputType,
        input,
        sourceWork,
      });

      if (profile.status === "not_fictional") {
        return res.status(422).json({
          error: {
            code: "not_fictional",
            message: "Known-character mode supports fictional characters only.",
          },
        });
      }

      if (profile.status === "ambiguous") {
        return res.status(409).json({
          error: {
            code: "ambiguous_character",
            message: profile.clarificationQuestion || "Add the character's source work or franchise.",
          },
        });
      }

      const session = sessionStore.createSession({
        inputType,
        sourceInput: input,
        profile,
      });

      res.set("Cache-Control", "no-store");
      return res.status(201).json({
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
        character: {
          id: session.characterId,
          ...profile,
        },
      });
    } catch (error) {
      console.error("Character generation failed:", error.message);
      return res.status(502).json({
        error: { message: "The character profile could not be generated right now." },
      });
    }
  });

  app.post("/api/sessions/:sessionId/end", (req, res) => {
    if (sessionStore && isValidSessionId(req.params.sessionId)) {
      sessionStore.deleteSession(req.params.sessionId);
    }
    res.set("Cache-Control", "no-store");
    return res.status(204).end();
  });

  app.post("/api/chat", async (req, res) => {
    const { history, sessionId } = req.body ?? {};

    if (!isValidHistory(history)) {
      return res.status(400).json({
        error: { message: "History must contain at least one valid chat message." },
      });
    }

    const character = getActiveCharacter(sessionId);
    if (!character) return sendExpiredSession(res);

    try {
      const response = await openaiClient.responses.create({
        model,
        store: false,
        input: [
          { role: "developer", content: buildCharacterInstruction(character.profile) },
          ...normalizeHistory(history),
        ],
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

  app.post("/api/chat/stream", async (req, res) => {
    const { history, sessionId, speak = true } = req.body ?? {};

    if (!isValidHistory(history)) {
      return res.status(400).json({
        error: { message: "History must contain at least one valid chat message." },
      });
    }

    const character = getActiveCharacter(sessionId);
    if (!character) return sendExpiredSession(res);

    const controller = new AbortController();
    res.on("close", () => controller.abort());

    try {
      const modelStream = await openaiClient.responses.create({
        model,
        store: false,
        input: [
          { role: "developer", content: buildCharacterInstruction(character.profile) },
          ...normalizeHistory(history),
        ],
        stream: true,
      }, { signal: controller.signal });

      setStreamingHeaders(res);

      let speechChain = Promise.resolve();
      let speechFailed = false;
      let sentenceIndex = 0;

      const queueSentence = (sentence) => {
        if (!speak || speechFailed) return;
        const index = sentenceIndex;
        sentenceIndex += 1;

        speechChain = speechChain.then(async () => {
          if (speechFailed || controller.signal.aborted) return;
          writeStreamEvent(res, { type: "speech_start", index });

          try {
            await streamSpeechAudio({
              speechEngine,
              text: sentence,
              signal: controller.signal,
              voice: character.profile.voice.voiceId,
              speed: character.profile.voice.speakingSpeed,
              onChunk: (chunk) => writeStreamEvent(res, {
                type: "audio",
                index,
                audio: Buffer.from(chunk).toString("base64"),
              }),
            });
            writeStreamEvent(res, { type: "speech_end", index });
          } catch (error) {
            if (controller.signal.aborted) return;
            speechFailed = true;
            console.error("Streaming speech failed:", error.message);
            writeStreamEvent(res, {
              type: "speech_error",
              message: "Voice synthesis was interrupted.",
            });
          }
        });
      };

      const sentenceChunker = createSentenceChunker(queueSentence);

      for await (const event of modelStream) {
        if (event.type === "response.output_text.delta") {
          sentenceChunker.push(event.delta);
          writeStreamEvent(res, { type: "text_delta", delta: event.delta });
        } else if (event.type === "error" || event.type === "response.failed") {
          throw new Error(event.message || event.response?.error?.message || "Model stream failed.");
        }
      }

      sentenceChunker.flush();
      writeStreamEvent(res, { type: "text_done" });
      await speechChain;
      writeStreamEvent(res, { type: "done" });
      return res.end();
    } catch (error) {
      if (controller.signal.aborted) return;

      console.error("Streaming chat failed:", error.message);
      if (!res.headersSent) {
        return res.status(502).json({
          error: { message: "The chatbot service is temporarily unavailable." },
        });
      }
      writeStreamEvent(res, {
        type: "error",
        message: "The chatbot stream was interrupted.",
      });
      return res.end();
    }
  });

  app.post("/api/speech", async (req, res) => {
    const text = req.body?.text?.trim();
    const character = getActiveCharacter(req.body?.sessionId);

    if (!text || text.length > 4096) {
      return res.status(400).json({
        error: { message: "Speech text must be between 1 and 4096 characters." },
      });
    }

    if (!character) return sendExpiredSession(res);

    try {
      const chunks = [];
      await streamSpeechAudio({
        speechEngine,
        text,
        voice: character.profile.voice.voiceId,
        speed: character.profile.voice.speakingSpeed,
        onChunk: (chunk) => chunks.push(Buffer.from(chunk)),
      });
      const audio = pcmToWav(chunks, speechEngine.sampleRate || 24_000);

      res.set({
        "Content-Type": "audio/wav",
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

  app.post("/api/speech/stream", async (req, res) => {
    const text = req.body?.text?.trim();
    const character = getActiveCharacter(req.body?.sessionId);

    if (!text || text.length > 4096) {
      return res.status(400).json({
        error: { message: "Speech text must be between 1 and 4096 characters." },
      });
    }

    if (!character) return sendExpiredSession(res);

    const controller = new AbortController();
    res.on("close", () => controller.abort());
    setStreamingHeaders(res);

    try {
      writeStreamEvent(res, { type: "speech_start", index: 0 });
      await streamSpeechAudio({
        speechEngine,
        text,
        signal: controller.signal,
        voice: character.profile.voice.voiceId,
        speed: character.profile.voice.speakingSpeed,
        onChunk: (chunk) => writeStreamEvent(res, {
          type: "audio",
          index: 0,
          audio: Buffer.from(chunk).toString("base64"),
        }),
      });
      writeStreamEvent(res, { type: "speech_end", index: 0 });
      writeStreamEvent(res, { type: "done" });
      return res.end();
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Streaming speech failed:", error.message);
      writeStreamEvent(res, {
        type: "error",
        message: "Speech generation is temporarily unavailable.",
      });
      return res.end();
    }
  });

  return app;
};
