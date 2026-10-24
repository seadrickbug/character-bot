import assert from "node:assert/strict";
import test from "node:test";
import {
  createKokoroSpeechEngine,
  float32ToPcm16,
} from "./kokoro.js";

test("float32ToPcm16 clamps and converts Kokoro samples", () => {
  const pcm = float32ToPcm16(Float32Array.from([-2, -1, 0, 1, 2]));
  const samples = Array.from(
    { length: pcm.length / 2 },
    (_, index) => pcm.readInt16LE(index * 2),
  );

  assert.deepEqual(samples, [-32768, -32768, 0, 32767, 32767]);
});

test("Kokoro engine loads once and streams bounded PCM chunks", async () => {
  let loadCount = 0;
  const requests = [];
  const engine = createKokoroSpeechEngine({
    chunkBytes: 4,
    loadModel: async () => {
      loadCount += 1;
      return {
        generate: async (text, options) => {
          requests.push({ text, options });
          return {
            sampling_rate: 24_000,
            audio: Float32Array.from([-1, -0.5, 0, 0.5, 1]),
          };
        },
      };
    },
  });
  const chunks = [];

  await engine.stream({
    text: "Hello locally.",
    onChunk: (chunk) => chunks.push(Buffer.from(chunk)),
  });
  await engine.warmup();

  assert.equal(loadCount, 1);
  assert.deepEqual(requests, [{
    text: "Hello locally.",
    options: { voice: "af_heart", speed: 1 },
  }]);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [4, 4, 2]);
});
