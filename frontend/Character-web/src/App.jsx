import { useState } from "react";
import ChatbotIcon from "./Components/ChatBotIcon";
import ChatForm from "./Components/ChatForm";
import ChatMessage from "./Components/ChatMessage";

const App = () => {
  const [chatHistory, setChatHistory] = useState([]);
  const generateChatbotResponse = (history) => {
    console.log( history);
  }

  return (
    <div className="container">
      <div className="chatbotPopup">
        {/* Chatbot Header */}
        <div className="chatheader">
            <ChatbotIcon />
          <h2 className="logo-text">ChatBot</h2>
        </div>
        <button className = "material-symbols-rounded">Chat</button>
      </div>

      {/* Chatbot Body */}
      <div className="chat-body">
        <div className="message-bot-message">
          <ChatbotIcon />
          <p className="bot-message">Hello! How can I assist you today?</p>
        </div>
        {/*render chat history dynamically*/}
          {chatHistory.map((chat, index) => (
            <ChatMessage key = {index} chat ={chat}/>
        ))}
      <div>
     
        {/* Chatbot Body */}
        <ChatForm chatHistory = {chatHistory} setChatHistory={setChatHistory} generateChatbotResponse={generateChatbotResponse}/>
      
     </div>
    </div>
    </div>
  );
};

export default App
