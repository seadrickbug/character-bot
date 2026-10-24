import { KokoroTTS } from "kokoro-js";

export const KOKORO_SAMPLE_RATE = 24_000;
const DEFAULT_PCM_CHUNK_BYTES = 4_800;

const throwIfAborted = (signal) => {
  if (signal?.aborted) {
    throw new DOMException("Speech synthesis was aborted.", "AbortError");
  }
};

export const float32ToPcm16 = (samples) => {
  const pcm = Buffer.allocUnsafe(samples.length * 2);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    pcm.writeInt16LE(Math.round(value), index * 2);
  }

  return pcm;
};

export const createKokoroSpeechEngine = ({
  modelId = "onnx-community/Kokoro-82M-v1.0-ONNX",
  voice = "af_heart",
  dtype = "q8",
  device = "cpu",
  speed = 1,
  chunkBytes = DEFAULT_PCM_CHUNK_BYTES,
  loadModel = (id, options) => KokoroTTS.from_pretrained(id, options),
} = {}) => {
  let modelPromise;
  let generationQueue = Promise.resolve();

  const getModel = () => {
    if (!modelPromise) {
      modelPromise = loadModel(modelId, { dtype, device }).catch((error) => {
        modelPromise = undefined;
        throw error;
      });
    }
    return modelPromise;
  };

  const stream = ({ text, signal, onChunk, voice: requestedVoice, speed: requestedSpeed }) => {
    const generate = async () => {
      throwIfAborted(signal);
      const tts = await getModel();
      throwIfAborted(signal);

      // The app has already split the LLM output into one sentence. Generating
      // that sentence directly also avoids kokoro-js@1.2.1's open string stream.
      const audio = await tts.generate(text, {
        voice: requestedVoice || voice,
        speed: Number.isFinite(requestedSpeed) ? requestedSpeed : speed,
      });
      if (audio.sampling_rate !== KOKORO_SAMPLE_RATE) {
        throw new Error(`Kokoro returned unsupported ${audio.sampling_rate} Hz audio.`);
      }

      const pcm = float32ToPcm16(audio.audio);
      for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
        throwIfAborted(signal);
        onChunk(pcm.subarray(offset, offset + chunkBytes));
      }
    };

    // A single local model is shared by all requests. Serializing inference avoids
    // overlapping CPU-heavy sessions while still streaming each result immediately.
    const task = generationQueue.then(generate, generate);
    generationQueue = task.catch(() => {});
    return task;
  };

  return {
    modelId,
    voice,
    sampleRate: KOKORO_SAMPLE_RATE,
    warmup: getModel,
    stream,
  };
};
