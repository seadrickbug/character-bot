import React, { useRef } from 'react'

const ChatForm = ({chatHistory, setChatHistory, generateChatbotResponse}) => {
    const inputRef = useRef();

    const handleFormSubmit = (event) => {
        event.preventDefault();
        const userMessage = inputRef.current.value.trim();
        if (!userMessage) return;
        inputRef.current.value = '';
        
        //update chat history with the new user message
        setChatHistory(history => [...history, { role: 'user', message: userMessage }]);

        //Add at least 600ms delay before adding the "Thinking..." message to the chat history
        setTimeout(() => {
            setChatHistory((history) => [...history, { role: 'model', message: "Thinking... "}]);
        // Call the generateBotResponse function to get the bot's response
        generateChatbotResponse([...chatHistory, { role: 'user', message: userMessage }]);
    }, 600)

       
    };

       


  return (
          <form action="#" className="chat-form" onSubmit={handleFormSubmit}>
            <input ref={inputRef} type="text" placeholder="Message" className="chat-input" required />
            <button className="material-symbols-rounded">Send</button>
          </form>
  )
}

export default ChatForm;