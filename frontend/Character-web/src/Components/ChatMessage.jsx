import ChatbotIcon from "./ChatBotIcon";

const ChatMessage = ({ chat, onSpeak, characterName }) => {
  const isBot = chat.role === "model";
  const isThinking = isBot && chat.message === "Thinking...";

  return (
    <article className={`message ${isBot ? "bot-message" : "user-message"}`}>
      {isBot && (
        <div className="message-avatar" aria-hidden="true">
          <ChatbotIcon />
        </div>
      )}

      <div className="message-content">
        <div className="message-meta">
          <span>{isBot ? characterName : "You"}</span>
        </div>

        <div className={`message-bubble ${isThinking ? "is-thinking" : ""}`}>
          {isThinking ? (
            <div className="typing-indicator" aria-label={`${characterName} is thinking`}>
              <span /><span /><span />
            </div>
          ) : (
            <p className="message-text">{chat.message}</p>
          )}

          {isBot && !isThinking && (
            <button
              type="button"
              className="speak-message"
              aria-label="Read this response aloud"
              title="Read aloud"
              onClick={() => onSpeak(chat.message)}
            >
              <span className="material-symbols-rounded" aria-hidden="true">volume_up</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

export default ChatMessage;
