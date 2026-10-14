import { useCallback, useEffect, useRef, useState } from "react";
import ChatbotIcon from "./Components/ChatBotIcon";
import ChatForm from "./Components/ChatForm";
import ChatMessage from "./Components/ChatMessage";

const App = () => {
  const [chatHistory, setChatHistory] = useState([]);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [speechStatus, setSpeechStatus] = useState("");
  const [isResponding, setIsResponding] = useState(false);
  const autoSpeakRef = useRef(true);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const speechRequestRef = useRef(null);
  const messagesEndRef = useRef(null);

  const releaseSpeech = useCallback(() => {
    speechRequestRef.current?.abort();
    speechRequestRef.current = null;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  useEffect(() => releaseSpeech, [releaseSpeech]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const playSpeech = useCallback(async (text) => {
    releaseSpeech();

    const controller = new AbortController();
    speechRequestRef.current = controller;
    setSpeechStatus("Synthesizing voice signal...");

    try {
      const response = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error?.message || "Failed to generate speech");
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      audioUrlRef.current = audioUrl;
      audioRef.current = audio;
      speechRequestRef.current = null;

      audio.addEventListener("ended", () => {
        if (audioRef.current === audio) {
          releaseSpeech();
          setSpeechStatus("");
        }
      }, { once: true });

      await audio.play();
      setSpeechStatus("Voice channel active");
    } catch (error) {
      if (error.name === "AbortError") return;

      console.error(error);
      releaseSpeech();
      setSpeechStatus(
        error.name === "NotAllowedError"
          ? "Autoplay blocked — tap a message speaker to retry."
          : "Voice channel unavailable — text link remains active.",
      );
    }
  }, [releaseSpeech]);

  const toggleAutoSpeak = () => {
    const nextAutoSpeak = !autoSpeak;

    if (autoSpeak) {
      releaseSpeech();
      setSpeechStatus("");
    }
    autoSpeakRef.current = nextAutoSpeak;
    setAutoSpeak(nextAutoSpeak);
  };

  const generateChatbotResponse = async (history) => {
    const updateHistory = (message) => {
      setChatHistory((previous) => [
        ...previous.filter((item) => item.message !== "Thinking..."),
        { role: "model", message },
      ]);
    };

    releaseSpeech();
    setSpeechStatus("");
    setIsResponding(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to generate response");
      }

      updateHistory(data.message);
      if (autoSpeakRef.current) {
        playSpeech(data.message);
      }
    } catch (error) {
      console.error(error);
      updateHistory("The neural link was interrupted. Please try again.");
    } finally {
      setIsResponding(false);
    }
  };

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <aside className="identity-panel">
        <div className="brand-lockup">
          <span className="brand-mark">N</span>
          <div>
            <span className="eyebrow">Neural interface</span>
            <p className="brand-name">NEXA<span>//01</span></p>
          </div>
        </div>

        <div className="persona-core" aria-hidden="true">
          <div className="orbit orbit-outer" />
          <div className="orbit orbit-inner" />
          <div className="core-glow" />
          <div className="persona-icon"><ChatbotIcon /></div>
        </div>

        <div className="persona-copy">
          <div className="status-label"><span /> Character online</div>
          <h2>Meet Nexa.</h2>
          <p>An adaptive AI character with a voice, memory, and a little spark of its own.</p>
        </div>

        <div className="system-modules">
          <div className="module-row">
            <span className="module-index">01</span>
            <span>Dialogue synthesis</span>
            <i>READY</i>
          </div>
          <div className="module-row">
            <span className="module-index">02</span>
            <span>Neural voice</span>
            <i>READY</i>
          </div>
          <div className="module-row">
            <span className="module-index">03</span>
            <span>Context memory</span>
            <i>SYNC</i>
          </div>
        </div>

        <div className="panel-footer">
          <span>CORE v1.0</span>
          <span className="coordinates">01°17′N · 103°51′E</span>
        </div>
      </aside>

      <section className="chat-console" aria-label="Chat with Nexa">
        <header className="console-header">
          <div className="session-heading">
            <span className="eyebrow"><i className="live-dot" /> Live session</span>
            <h1>Conversation link</h1>
          </div>

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
              <small>Voice output</small>
              {autoSpeak ? "Active" : "Muted"}
            </span>
          </button>
        </header>

        <div className="console-rule"><span /></div>

        <section className="chat-body" aria-live="polite" aria-busy={isResponding}>
          <ChatMessage
            chat={{
              role: "model",
              message: "Neural link established. I'm Nexa — ask me anything, and I'll answer in voice and text.",
            }}
            onSpeak={playSpeech}
          />

          {chatHistory.map((chat, index) => (
            <ChatMessage key={index} chat={chat} onSpeak={playSpeech} />
          ))}
          <div ref={messagesEndRef} />
        </section>

        <div className="console-footer">
          <div className="voice-feedback">
            <span className={speechStatus ? "signal-bars is-active" : "signal-bars"} aria-hidden="true">
              <i /><i /><i /><i />
            </span>
            <p role="status">{speechStatus || "Voice channel standing by"}</p>
            <span className="ai-disclosure">AI-generated voice</span>
          </div>

          <ChatForm
            chatHistory={chatHistory}
            setChatHistory={setChatHistory}
            generateChatbotResponse={generateChatbotResponse}
            disabled={isResponding}
          />
          <p className="input-hint">Press Enter to transmit <span>·</span> Responses may be imperfect</p>
        </div>
      </section>
    </main>
  );
};

export default App;
