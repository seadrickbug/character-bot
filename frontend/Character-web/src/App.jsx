import { useCallback, useEffect, useRef, useState } from "react";
import ChatbotIcon from "./Components/ChatBotIcon";
import ChatForm from "./Components/ChatForm";
import ChatMessage from "./Components/ChatMessage";
import { CharacterPreview, CharacterSetup } from "./Components/CharacterCreator";

const PCM_SAMPLE_RATE = 24_000;
const PCM_BATCH_BYTES = 4_800;

const decodeBase64 = (value) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const readEventStream = async (response, onEvent) => {
  if (!response.body) throw new Error("The server returned an empty stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });

      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) onEvent(JSON.parse(line));
      }

      if (done) break;
    }

    if (pending.trim()) onEvent(JSON.parse(pending));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
};

const App = () => {
  const [session, setSession] = useState(null);
  const [screen, setScreen] = useState("setup");
  const [chatHistory, setChatHistory] = useState([]);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [speechStatus, setSpeechStatus] = useState("");
  const [isSpeechActive, setIsSpeechActive] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const autoSpeakRef = useRef(true);
  const chatRequestRef = useRef(null);
  const speechRequestRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioSourcesRef = useRef(new Set());
  const pcmQueueRef = useRef(new Uint8Array());
  const nextAudioTimeRef = useRef(0);
  const audioStreamDoneRef = useRef(false);
  const streamAudioEnabledRef = useRef(false);
  const messagesEndRef = useRef(null);
  const sessionIdRef = useRef(null);

  const prepareAudioContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error("Web Audio is not supported in this browser.");
      audioContextRef.current = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
    }

    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(() => {});
    }
    return audioContextRef.current;
  }, []);

  const releaseAudio = useCallback(() => {
    for (const source of audioSourcesRef.current) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // The source may already have completed.
      }
    }
    audioSourcesRef.current.clear();
    pcmQueueRef.current = new Uint8Array();
    nextAudioTimeRef.current = 0;
    audioStreamDoneRef.current = false;
    setIsSpeechActive(false);
  }, []);

  const releaseSpeech = useCallback(() => {
    speechRequestRef.current?.abort();
    speechRequestRef.current = null;
    releaseAudio();
  }, [releaseAudio]);

  const clearLocalSession = useCallback(() => {
    chatRequestRef.current?.abort();
    releaseSpeech();
    setChatHistory([]);
    setSpeechStatus("");
    setIsResponding(false);
    setSession(null);
    setScreen("setup");
    sessionIdRef.current = null;
  }, [releaseSpeech]);

  const endSession = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    clearLocalSession();
    if (!sessionId) return;

    await fetch(`/api/sessions/${sessionId}/end`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  }, [clearLocalSession]);

  const handleCharacterCreated = (createdSession) => {
    sessionIdRef.current = createdSession.sessionId;
    setSession(createdSession);
    setScreen("preview");
  };

  useEffect(() => () => {
    chatRequestRef.current?.abort();
    speechRequestRef.current?.abort();
    releaseAudio();
    audioContextRef.current?.close();
  }, [releaseAudio]);

  useEffect(() => {
    const handlePageHide = () => {
      const sessionId = sessionIdRef.current;
      if (sessionId) navigator.sendBeacon(`/api/sessions/${sessionId}/end`);
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const scheduleQueuedAudio = useCallback((flush = false) => {
    const context = audioContextRef.current;
    const queued = pcmQueueRef.current;
    if (!context || queued.length < 2) return;

    const usableBytes = flush
      ? queued.length - (queued.length % 2)
      : queued.length >= PCM_BATCH_BYTES
        ? queued.length - (queued.length % 2)
        : 0;
    if (!usableBytes) return;

    const pcm = queued.slice(0, usableBytes);
    pcmQueueRef.current = queued.slice(usableBytes);
    const samples = new Float32Array(pcm.length / 2);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);

    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32768;
    }

    const audioBuffer = context.createBuffer(1, samples.length, PCM_SAMPLE_RATE);
    audioBuffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);

    const startAt = Math.max(nextAudioTimeRef.current, context.currentTime + 0.04);
    source.start(startAt);
    nextAudioTimeRef.current = startAt + audioBuffer.duration;
    audioSourcesRef.current.add(source);
    setIsSpeechActive(true);
    setSpeechStatus("Talking...");

    source.onended = () => {
      audioSourcesRef.current.delete(source);
      if (audioStreamDoneRef.current && audioSourcesRef.current.size === 0) {
        setIsSpeechActive(false);
        setSpeechStatus("");
      }
    };
  }, []);

  const enqueueAudio = useCallback((base64Audio) => {
    const incoming = decodeBase64(base64Audio);
    const queued = pcmQueueRef.current;
    const combined = new Uint8Array(queued.length + incoming.length);
    combined.set(queued);
    combined.set(incoming, queued.length);
    pcmQueueRef.current = combined;
    scheduleQueuedAudio(false);
  }, [scheduleQueuedAudio]);

  const finishAudioStream = useCallback(() => {
    scheduleQueuedAudio(true);
    audioStreamDoneRef.current = true;
    if (audioSourcesRef.current.size === 0) {
      setIsSpeechActive(false);
      setSpeechStatus("");
    }
  }, [scheduleQueuedAudio]);

  const handleAudioEvent = useCallback((event, enabled = true) => {
    if (event.type === "speech_start" && enabled) {
      setIsSpeechActive(true);
      setSpeechStatus("Getting the voice ready...");
    } else if (event.type === "audio" && enabled) {
      enqueueAudio(event.audio);
    } else if (event.type === "speech_end" && enabled) {
      scheduleQueuedAudio(true);
    } else if (event.type === "speech_error" && enabled) {
      finishAudioStream();
      setIsSpeechActive(false);
      setSpeechStatus("Voice paused. Text still works.");
    }
  }, [enqueueAudio, finishAudioStream, scheduleQueuedAudio]);

  const playSpeech = useCallback(async (text) => {
    releaseSpeech();
    prepareAudioContext();

    const controller = new AbortController();
    speechRequestRef.current = controller;
    setIsSpeechActive(true);
    setSpeechStatus("Getting the voice ready...");

    try {
      const response = await fetch("/api/speech/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sessionId: sessionIdRef.current }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 410) {
          clearLocalSession();
          return;
        }
        throw new Error(data.error?.message || "Failed to generate speech");
      }

      await readEventStream(response, (event) => {
        if (event.type === "error") throw new Error(event.message);
        handleAudioEvent(event, true);
        if (event.type === "done") finishAudioStream();
      });
    } catch (error) {
      if (error.name === "AbortError") return;

      console.error(error);
      releaseAudio();
      setSpeechStatus("Voice is unavailable. Text still works.");
    } finally {
      if (speechRequestRef.current === controller) speechRequestRef.current = null;
    }
  }, [clearLocalSession, finishAudioStream, handleAudioEvent, prepareAudioContext, releaseAudio, releaseSpeech]);

  const toggleAutoSpeak = () => {
    const nextAutoSpeak = !autoSpeak;

    if (autoSpeak) {
      streamAudioEnabledRef.current = false;
      releaseAudio();
      speechRequestRef.current?.abort();
      setSpeechStatus("");
    }
    autoSpeakRef.current = nextAutoSpeak;
    setAutoSpeak(nextAutoSpeak);
  };

  const endSpeech = () => {
    streamAudioEnabledRef.current = false;
    speechRequestRef.current?.abort();
    speechRequestRef.current = null;
    releaseAudio();
    setSpeechStatus("Voice stopped");
  };

  const generateChatbotResponse = async (history) => {
    releaseSpeech();
    setSpeechStatus("");
    setIsResponding(true);
    const shouldSpeak = autoSpeakRef.current;
    streamAudioEnabledRef.current = shouldSpeak;
    if (shouldSpeak) prepareAudioContext();

    const controller = new AbortController();
    chatRequestRef.current = controller;
    let receivedText = false;

    const appendText = (delta) => {
      const isFirstDelta = !receivedText;
      receivedText = true;
      setChatHistory((previous) => {
        const next = previous.filter((item) => item.message !== "Thinking...");
        if (isFirstDelta) return [...next, { role: "model", message: delta }];

        const lastIndex = next.length - 1;
        next[lastIndex] = {
          ...next[lastIndex],
          message: `${next[lastIndex].message}${delta}`,
        };
        return next;
      });
    };

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history,
          sessionId: sessionIdRef.current,
          speak: shouldSpeak,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 410) {
          clearLocalSession();
          return;
        }
        throw new Error(data.error?.message || "Failed to generate response");
      }

      await readEventStream(response, (event) => {
        if (event.type === "text_delta") {
          appendText(event.delta);
        } else if (event.type === "text_done") {
          setIsResponding(false);
        } else if (event.type === "error") {
          throw new Error(event.message);
        } else if (event.type === "done") {
          if (streamAudioEnabledRef.current) finishAudioStream();
        } else {
          handleAudioEvent(event, streamAudioEnabledRef.current);
        }
      });
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error(error);
        if (!receivedText) {
          setChatHistory((previous) => [
            ...previous.filter((item) => item.message !== "Thinking..."),
            { role: "model", message: "Oops! Something went wrong. Please try again." },
          ]);
        }
      }
    } finally {
      if (chatRequestRef.current === controller) chatRequestRef.current = null;
      setIsResponding(false);
    }
  };

  const character = session?.character;
  const identityStatus = screen === "chat"
    ? "Ready to chat"
    : screen === "preview"
      ? "Looking good!"
      : "Let’s make a friend";
  const identityTitle = character ? `Meet ${character.displayName}!` : "Your next buddy is waiting.";
  const identitySummary = character?.summary
    || "Dream up a personality, pick a voice, and start talking.";

  return (
    <main className={`app-shell ${screen !== "chat" ? "creation-shell" : ""}`}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <aside className="identity-panel">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">TB</span>
          <div>
            <p className="brand-name">Talking <span>Buddy</span></p>
          </div>
        </div>

        <div className="persona-core" aria-hidden="true">
          <div className="orbit orbit-outer" />
          <div className="orbit orbit-inner" />
          <div className="core-glow" />
          <div className="persona-icon"><ChatbotIcon /></div>
        </div>

        <div className="persona-copy">
          <div className="status-label"><span /> {identityStatus}</div>
          <h2>{identityTitle}</h2>
          <p>{identitySummary}</p>
        </div>

        <div className="buddy-doodles" aria-hidden="true"><span>★</span><span>♥</span><span>●</span></div>
      </aside>

      {screen === "setup" && <CharacterSetup onCreated={handleCharacterCreated} />}

      {screen === "preview" && session && (
        <CharacterPreview
          session={session}
          onStart={() => setScreen("chat")}
          onDiscard={endSession}
        />
      )}

      {screen === "chat" && character && (
        <section className="chat-console" aria-label={`Chat with ${character.displayName}`}>
          <header className="console-header">
            <div className="session-heading">
              <span className="online-label"><i className="live-dot" /> Online</span>
              <h1>{character.displayName}</h1>
            </div>

            <div className="header-actions">
              <button type="button" className="session-end-button" onClick={endSession}>
                End session
              </button>
              <button
                type="button"
                className={`speech-toggle ${autoSpeak ? "is-active" : ""}`}
                aria-pressed={autoSpeak}
                onClick={toggleAutoSpeak}
              >
                <span className="toggle-icon" aria-hidden="true">
                  {autoSpeak ? "volume_up" : "volume_off"}
                </span>
                <span>
                  <small>Voice</small>
                  {autoSpeak ? "On" : "Off"}
                </span>
              </button>
            </div>
          </header>

          <div className="console-rule"><span /></div>

          <section className="chat-body" aria-live="polite" aria-busy={isResponding}>
            <ChatMessage
              chat={{ role: "model", message: character.greeting }}
              onSpeak={playSpeech}
              characterName={character.displayName}
            />

            {chatHistory.map((chat, index) => (
              <ChatMessage
                key={index}
                chat={chat}
                onSpeak={playSpeech}
                characterName={character.displayName}
              />
            ))}
            <div ref={messagesEndRef} />
          </section>

          <div className="console-footer">
            <div className="voice-feedback">
              <span className={isSpeechActive ? "signal-bars is-active" : "signal-bars"} aria-hidden="true">
                <i /><i /><i /><i />
              </span>
              <p role="status">{speechStatus || "Voice ready"}</p>
              <button
                type="button"
                className="end-speech"
                onClick={endSpeech}
                disabled={!isSpeechActive}
              >
                <span className="material-symbols-rounded" aria-hidden="true">stop_circle</span>
                End speech
              </button>
            </div>

            <ChatForm
              chatHistory={chatHistory}
              setChatHistory={setChatHistory}
              generateChatbotResponse={generateChatbotResponse}
              disabled={isResponding}
              characterName={character.displayName}
            />
          </div>
        </section>
      )}
    </main>
  );
};

export default App;
