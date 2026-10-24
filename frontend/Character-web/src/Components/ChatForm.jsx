import { useRef } from "react";

const ChatForm = ({
  chatHistory,
  setChatHistory,
  generateChatbotResponse,
  disabled,
  characterName,
}) => {
  const inputRef = useRef();

  const handleFormSubmit = (event) => {
    event.preventDefault();
    const userMessage = inputRef.current.value.trim();

    if (!userMessage || disabled) return;
    inputRef.current.value = "";

    const nextHistory = [...chatHistory, { role: "user", message: userMessage }];
    setChatHistory([...nextHistory, { role: "model", message: "Thinking..." }]);
    generateChatbotResponse(nextHistory);
  };

  return (
    <form className="chat-form" onSubmit={handleFormSubmit}>
      <span className="prompt-glyph material-symbols-rounded" aria-hidden="true">chat_bubble</span>
      <input
        ref={inputRef}
        type="text"
        placeholder={disabled ? `${characterName} is thinking...` : `Message ${characterName}...`}
        className="chat-input"
        aria-label={`Message ${characterName}`}
        autoComplete="off"
        disabled={disabled}
        required
      />
      <button className="send-button" type="submit" disabled={disabled} aria-label="Send message">
        <span>{disabled ? "Wait" : "Send"}</span>
        <span className="material-symbols-rounded" aria-hidden="true">arrow_upward</span>
      </button>
    </form>
  );
};

export default ChatForm;
