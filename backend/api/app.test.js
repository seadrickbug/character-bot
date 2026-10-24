import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "./app.js";
import { SessionStore } from "./session-store.js";

const testProfile = {
  status: "ready",
  clarificationQuestion: "",
  displayName: "Test Character",
  sourceWork: "Test Stories",
  tagline: "Always ready for a test.",
  summary: "A thoughtful fictional character who answers clearly.",
  traits: ["thoughtful", "curious", "patient", "witty"],
  backstory: "Created for a test suite.",
  motivations: "Help the user understand the result.",
  conversationStyle: "Warm, concise, and attentive.",
  vocabularyStyle: "Clear modern language.",
  humorStyle: "Gentle wordplay.",
  emotionalTone: "Calm optimism.",
  behavioralBoundaries: ["Stay fictional", "Do not imitate a real person"],
  greeting: "Hello from the test character.",
  exampleDialogue: ["Let us begin.", "That is worth exploring."],
  avatarPrompt: "An original illustrated character portrait.",
  voice: {
    voiceId: "af_nicole",
    label: "Calm and composed",
    speakingSpeed: 0.95,
    energy: "medium",
    expression: "Measured and warm",
  },
};

const defaultSpeechEngine = {
  sampleRate: 24_000,
  stream: async ({ onChunk }) => onChunk(Uint8Array.from([1, 0, 2, 0])),
};

const startTestServer = async (openaiClient, speechEngine = defaultSpeechEngine) => {
  const sessionStore = new SessionStore();
  const session = sessionStore.createSession({
    inputType: "prompt",
    sourceInput: "A character made for tests",
    profile: testProfile,
  });
  const app = createApp({
    openaiClient,
    model: "test-model",
    speechEngine,
    sessionStore,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    sessionId: session.sessionId,
    sessionStore,
    close: () => new Promise((resolve) => server.close(() => {
      sessionStore.close();
      resolve();
    })),
  };
};

test("GET /api/health reports that the backend is available", async () => {
  const server = await startTestServer({ responses: { create: async () => ({}) } });

  try {
    const response = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      message: "Backend API is connected",
    });
  } finally {
    await server.close();
  }
});

test("POST /api/characters generates and stores a temporary fictional profile", async () => {
  let request;
  const server = await startTestServer({
    responses: {
      create: async (body) => {
        request = body;
        return { output_text: JSON.stringify({ ...testProfile, displayName: "Sherlock Holmes" }) };
      },
    },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/characters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputType: "known",
        input: "Sherlock Holmes",
        sourceWork: "Arthur Conan Doyle stories",
      }),
    });
    const data = await response.json();

    assert.equal(response.status, 201);
    assert.equal(data.character.displayName, "Sherlock Holmes");
    assert.equal(data.character.voice.voiceId, "af_nicole");
    assert.ok(data.sessionId);
    assert.equal(server.sessionStore.getCharacter(data.sessionId).profile.displayName, "Sherlock Holmes");
    assert.equal(request.store, false);
    assert.equal(request.text.format.type, "json_schema");
    assert.equal(request.text.format.strict, true);
    assert.match(request.input, /known fictional character/);
    assert.match(request.input, /Arthur Conan Doyle stories/);
  } finally {
    await server.close();
  }
});

test("POST /api/characters rejects real people and does not create a session", async () => {
  const server = await startTestServer({
    responses: {
      create: async () => ({
        output_text: JSON.stringify({ ...testProfile, status: "not_fictional" }),
      }),
    },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/characters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputType: "known", input: "A real public figure" }),
    });
    const data = await response.json();

    assert.equal(response.status, 422);
    assert.equal(data.error.code, "not_fictional");
  } finally {
    await server.close();
  }
});

test("ending a session removes its character profile and blocks further chat", async () => {
  let modelCalls = 0;
  const server = await startTestServer({
    responses: {
      create: async () => {
        modelCalls += 1;
        return { output_text: "This should not be reached." };
      },
    },
  });

  try {
    const endResponse = await fetch(`${server.baseUrl}/api/sessions/${server.sessionId}/end`, {
      method: "POST",
    });
    assert.equal(endResponse.status, 204);
    assert.equal(server.sessionStore.getCharacter(server.sessionId), null);

    const chatResponse = await fetch(`${server.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: server.sessionId,
        history: [{ role: "user", message: "Are you there?" }],
      }),
    });

    assert.equal(chatResponse.status, 410);
    assert.equal(modelCalls, 0);
  } finally {
    await server.close();
  }
});

test("POST /api/chat sends normalized history and returns generated text", async () => {
  let request;
  const server = await startTestServer({
    responses: {
      create: async (body) => {
        request = body;
        return { output_text: " Hello from the bot! " };
      },
    },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: server.sessionId,
        history: [
          { role: "user", message: "Hello" },
          { role: "model", message: "Hi" },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { message: "Hello from the bot!" });
    assert.equal(request.model, "test-model");
    assert.equal(request.store, false);
    assert.match(request.input[0].content, /Test Character/);
    assert.deepEqual(request.input.slice(1), [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ]);
  } finally {
    await server.close();
  }
});

test("POST /api/chat rejects an invalid history", async () => {
  const server = await startTestServer({ responses: { create: async () => ({}) } });

  try {
    const response = await fetch(`${server.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history: [] }),
    });

    assert.equal(response.status, 400);
  } finally {
    await server.close();
  }
});

test("POST /api/chat converts upstream failures to a safe error", async () => {
  const server = await startTestServer({
    responses: { create: async () => Promise.reject(new Error("upstream details")) },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: server.sessionId,
        history: [{ role: "user", message: "Hello" }],
      }),
    });

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: { message: "The chatbot service is temporarily unavailable." },
    });
  } finally {
    await server.close();
  }
});

test("POST /api/speech returns Kokoro PCM wrapped as WAV audio", async () => {
  let request;
  const pcm = Uint8Array.from([1, 0, 2, 0]);
  const server = await startTestServer(
    { responses: { create: async () => ({}) } },
    {
      sampleRate: 24_000,
      stream: async (options) => {
        request = options;
        options.onChunk(pcm);
      },
    },
  );

  try {
    const response = await fetch(`${server.baseUrl}/api/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: server.sessionId,
        text: "Hello from the character.",
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/wav");
    const wav = Buffer.from(await response.arrayBuffer());
    assert.equal(wav.subarray(0, 4).toString(), "RIFF");
    assert.equal(wav.readUInt32LE(24), 24_000);
    assert.deepEqual(wav.subarray(44), Buffer.from(pcm));
    assert.equal(request.text, "Hello from the character.");
    assert.equal(request.voice, "af_nicole");
    assert.equal(request.speed, 0.95);
  } finally {
    await server.close();
  }
});

test("POST /api/speech rejects empty or oversized text", async () => {
  let callCount = 0;
  const server = await startTestServer(
    { responses: { create: async () => ({}) } },
    {
      sampleRate: 24_000,
      stream: async () => {
        callCount += 1;
      },
    },
  );

  try {
    for (const text of ["", "a".repeat(4097)]) {
      const response = await fetch(`${server.baseUrl}/api/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: server.sessionId, text }),
      });

      assert.equal(response.status, 400);
    }

    assert.equal(callCount, 0);
  } finally {
    await server.close();
  }
});

test("POST /api/speech converts upstream failures to a safe error", async () => {
  const server = await startTestServer(
    { responses: { create: async () => ({}) } },
    {
      sampleRate: 24_000,
      stream: async () => Promise.reject(new Error("speech upstream details")),
    },
  );

  try {
    const response = await fetch(`${server.baseUrl}/api/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: server.sessionId, text: "Hello" }),
    });

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: { message: "Speech generation is temporarily unavailable." },
    });
  } finally {
    await server.close();
  }
});

test("POST /api/chat/stream chunks model text into ordered speech streams", async () => {
  let modelRequest;
  const speechRequests = [];
  const modelEvents = async function* () {
    yield { type: "response.output_text.delta", delta: "First sentence. Sec" };
    yield { type: "response.output_text.delta", delta: "ond sentence!" };
    yield { type: "response.completed" };
  };
  const server = await startTestServer(
    {
      responses: {
        create: async (body) => {
          modelRequest = body;
          return modelEvents();
        },
      },
    },
    {
      sampleRate: 24_000,
      stream: async (options) => {
        speechRequests.push(options);
        const marker = speechRequests.length;
        options.onChunk(Uint8Array.from([marker, 0, marker, 0]));
      },
    },
  );

  try {
    const response = await fetch(`${server.baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: server.sessionId,
        history: [{ role: "user", message: "Tell me two sentences." }],
        speak: true,
      }),
    });
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
    assert.equal(modelRequest.model, "test-model");
    assert.equal(modelRequest.store, false);
    assert.equal(modelRequest.stream, true);
    assert.match(modelRequest.input[0].content, /Test Character/);
    assert.deepEqual(modelRequest.input.slice(1), [
      { role: "user", content: "Tell me two sentences." },
    ]);
    assert.equal(
      events.filter((event) => event.type === "text_delta").map((event) => event.delta).join(""),
      "First sentence. Second sentence!",
    );
    assert.deepEqual(
      speechRequests.map((request) => request.text),
      ["First sentence.", "Second sentence!"],
    );
    assert.ok(speechRequests.every((request) => request.voice === "af_nicole"));
    assert.ok(speechRequests.every((request) => request.speed === 0.95));
    assert.ok(events.some((event) => event.type === "audio"));
    assert.deepEqual(
      events.filter((event) => event.type === "speech_start").map((event) => event.index),
      [0, 1],
    );
    assert.equal(events.at(-1).type, "done");
  } finally {
    await server.close();
  }
});

test("POST /api/chat/stream skips TTS when speech is disabled", async () => {
  let speechCalls = 0;
  const server = await startTestServer(
    {
      responses: {
        create: async () => (async function* () {
          yield { type: "response.output_text.delta", delta: "Text only." };
        })(),
      },
    },
    {
      sampleRate: 24_000,
      stream: async () => {
        speechCalls += 1;
      },
    },
  );

  try {
    const response = await fetch(`${server.baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: server.sessionId,
        history: [{ role: "user", message: "Hello" }],
        speak: false,
      }),
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /"type":"text_delta"/);
    assert.doesNotMatch(body, /"type":"audio"/);
    assert.equal(speechCalls, 0);
  } finally {
    await server.close();
  }
});

test("POST /api/speech/stream returns PCM chunks without buffering a file", async () => {
  let request;
  const pcm = Uint8Array.from([1, 0, 2, 0]);
  const server = await startTestServer(
    { responses: { create: async () => ({}) } },
    {
      sampleRate: 24_000,
      stream: async (options) => {
        request = options;
        options.onChunk(pcm);
      },
    },
  );

  try {
    const response = await fetch(`${server.baseUrl}/api/speech/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: server.sessionId, text: "Replay me." }),
    });
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const audioEvent = events.find((event) => event.type === "audio");

    assert.equal(response.status, 200);
    assert.equal(request.text, "Replay me.");
    assert.deepEqual(Buffer.from(audioEvent.audio, "base64"), Buffer.from(pcm));
    assert.equal(events.at(-1).type, "done");
  } finally {
    await server.close();
  }
});
