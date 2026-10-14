import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "./app.js";

const startTestServer = async (openaiClient) => {
  const app = createApp({ openaiClient, model: "test-model" });
  const server = app.listen(0);
  await once(server, "listening");

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
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
        history: [
          { role: "user", message: "Hello" },
          { role: "model", message: "Hi" },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { message: "Hello from the bot!" });
    assert.deepEqual(request, {
      model: "test-model",
      input: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ],
    });
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
      body: JSON.stringify({ history: [{ role: "user", message: "Hello" }] }),
    });

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: { message: "The chatbot service is temporarily unavailable." },
    });
  } finally {
    await server.close();
  }
});

test("POST /api/speech returns generated MP3 audio", async () => {
  let request;
  const audioBytes = Uint8Array.from([73, 68, 51, 4]);
  const server = await startTestServer({
    audio: {
      speech: {
        create: async (body) => {
          request = body;
          return { arrayBuffer: async () => audioBytes.buffer };
        },
      },
    },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello from the character." }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    assert.deepEqual(
      new Uint8Array(await response.arrayBuffer()),
      audioBytes,
    );
    assert.deepEqual(request, {
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: "Hello from the character.",
      instructions: "Speak naturally in a warm, conversational tone.",
      response_format: "mp3",
    });
  } finally {
    await server.close();
  }
});

test("POST /api/speech rejects empty or oversized text", async () => {
  let callCount = 0;
  const server = await startTestServer({
    audio: {
      speech: {
        create: async () => {
          callCount += 1;
        },
      },
    },
  });

  try {
    for (const text of ["", "a".repeat(4097)]) {
      const response = await fetch(`${server.baseUrl}/api/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      assert.equal(response.status, 400);
    }

    assert.equal(callCount, 0);
  } finally {
    await server.close();
  }
});

test("POST /api/speech converts upstream failures to a safe error", async () => {
  const server = await startTestServer({
    audio: {
      speech: {
        create: async () => Promise.reject(new Error("speech upstream details")),
      },
    },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: { message: "Speech generation is temporarily unavailable." },
    });
  } finally {
    await server.close();
  }
});
