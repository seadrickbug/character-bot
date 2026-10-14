import { useRef } from "react";

const ChatForm = ({
  chatHistory,
  setChatHistory,
  generateChatbotResponse,
  disabled,
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
      <span className="prompt-glyph" aria-hidden="true">›_</span>
      <input
        ref={inputRef}
        type="text"
        placeholder={disabled ? "Nexa is processing..." : "Send a message to Nexa..."}
        className="chat-input"
        aria-label="Message Nexa"
        autoComplete="off"
        disabled={disabled}
        required
      />
      <button className="send-button" type="submit" disabled={disabled} aria-label="Send message">
        <span>{disabled ? "WAIT" : "SEND"}</span>
        <span className="material-symbols-rounded" aria-hidden="true">north_east</span>
      </button>
    </form>
  );
};

export default ChatForm;
