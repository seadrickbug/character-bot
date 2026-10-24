import { useState } from "react";
import ChatbotIcon from "./ChatBotIcon";

const examples = {
  prompt: [
    "A retired starship captain who hides a soft heart behind dry humor",
    "An optimistic forest witch who gives terrible practical advice",
  ],
  known: ["Sherlock Holmes", "Princess Leia"],
};

export const CharacterSetup = ({ onCreated }) => {
  const [inputType, setInputType] = useState("prompt");
  const [input, setInput] = useState("");
  const [sourceWork, setSourceWork] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  const selectMode = (nextMode) => {
    setInputType(nextMode);
    setInput("");
    setSourceWork("");
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const normalizedInput = input.trim();
    if (normalizedInput.length < 3 || isGenerating) return;

    setIsGenerating(true);
    setError("");

    try {
      const response = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputType,
          input: normalizedInput,
          sourceWork: inputType === "known" ? sourceWork.trim() : "",
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error?.message || "Character generation failed. Please try again.");
      }

      onCreated(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <section className="creator-console" aria-labelledby="creator-title">
      <header className="creator-header">
        <h1 id="creator-title">Make a buddy</h1>
        <p>Invent someone new or pick a fictional favorite.</p>
      </header>

      <form className="creator-form" onSubmit={handleSubmit}>
        <fieldset className="mode-picker">
          <legend className="sr-only">Choose a character type</legend>
          <button
            type="button"
            className={inputType === "prompt" ? "mode-card is-active" : "mode-card"}
            aria-pressed={inputType === "prompt"}
            onClick={() => selectMode("prompt")}
          >
            <span className="material-symbols-rounded" aria-hidden="true">auto_awesome</span>
            <span><strong>Someone new</strong><small>Describe your own</small></span>
          </button>
          <button
            type="button"
            className={inputType === "known" ? "mode-card is-active" : "mode-card"}
            aria-pressed={inputType === "known"}
            onClick={() => selectMode("known")}
          >
            <span className="material-symbols-rounded" aria-hidden="true">theater_comedy</span>
            <span><strong>A favorite</strong><small>Fictional only</small></span>
          </button>
        </fieldset>

        <label className="creator-field">
          <span>{inputType === "known" ? "Who?" : "Describe them"}</span>
          {inputType === "known" ? (
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="e.g. Sherlock Holmes"
              maxLength={1500}
              disabled={isGenerating}
              autoFocus
              required
            />
          ) : (
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="A brave little ghost who loves bad jokes..."
              maxLength={1500}
              rows={5}
              disabled={isGenerating}
              autoFocus
              required
            />
          )}
        </label>

        {inputType === "known" && (
          <label className="creator-field compact-field">
            <span>From where? <i>optional</i></span>
            <input
              value={sourceWork}
              onChange={(event) => setSourceWork(event.target.value)}
              placeholder="e.g. Arthur Conan Doyle stories"
              maxLength={120}
              disabled={isGenerating}
            />
          </label>
        )}

        <div className="example-prompts" aria-label="Example inputs">
          <span>Need an idea?</span>
          <div>
            {examples[inputType].map((example) => (
              <button type="button" key={example} onClick={() => setInput(example)} disabled={isGenerating}>
                {example}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="creator-error" role="alert">{error}</p>}

        <div className="creator-submit-row">
          <p><span className="material-symbols-rounded" aria-hidden="true">lock_clock</span> Gone when you leave</p>
          <button
            className={`forge-button ${isGenerating ? "is-generating" : ""}`}
            type="submit"
            disabled={input.trim().length < 3 || isGenerating}
          >
            <span>{isGenerating ? "Making your buddy..." : "Make my buddy"}</span>
            <span className="material-symbols-rounded" aria-hidden="true">
              {isGenerating ? "progress_activity" : "arrow_forward"}
            </span>
          </button>
        </div>
      </form>
    </section>
  );
};

export const CharacterPreview = ({ session, onStart, onDiscard }) => {
  const character = session.character;

  return (
    <section className="preview-console" aria-labelledby="preview-title">
      <header className="preview-header">
        <h1 id="preview-title">Your buddy is ready!</h1>
      </header>

      <article className="character-preview-card">
        <div className="preview-avatar" aria-hidden="true">
          <span className="avatar-orbit" />
          <ChatbotIcon />
        </div>
        <div className="preview-identity">
          <p>{character.sourceWork || "Original character"}</p>
          <h2>{character.displayName}</h2>
          <blockquote>{character.tagline}</blockquote>
        </div>

        <p className="preview-summary">{character.summary}</p>

        <div className="trait-list" aria-label="Character traits">
          {character.traits.map((trait) => <span key={trait}>{trait}</span>)}
        </div>

        <div className="profile-specs">
          <div>
            <span>Voice</span>
            <p>{character.voice.label} · {character.voice.energy} energy</p>
          </div>
          <div>
            <span>Vibe</span>
            <p>{character.emotionalTone}</p>
          </div>
        </div>
      </article>

      <div className="preview-actions">
        <button type="button" className="secondary-button" onClick={onDiscard}>Start over</button>
        <button type="button" className="forge-button" onClick={onStart}>
          <span>Start chat</span>
          <span className="material-symbols-rounded" aria-hidden="true">forum</span>
        </button>
      </div>
      <p className="session-notice">Deleted when this chat ends.</p>
    </section>
  );
};
