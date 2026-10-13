import { useState } from "react";
import ChatbotIcon from "./Components/ChatBotIcon";
import ChatForm from "./Components/ChatForm";
import ChatMessage from "./Components/ChatMessage";

const App = () => {
  const [chatHistory, setChatHistory] = useState([]);
  //helper function to generate the chatbot response based on the chat history
  const generateChatbotResponse = async (history) => {
    const updateHistory = (message) => {
      setChatHistory(prev => [...prev.filter(msg =>msg.text !== "Thinking..."), {role: "model", message}]);
    };

    //format chat history to match the API request format
    history = history.map(({role, message}) => ({role, parts: [{text: message}]}))
    const requstOptions = {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({contents: history})
    }

    try{
      //make the api call to the chatbot API
      const response = await fetch(import.meta.env.VITE_API_URL, requstOptions);
      const data = await response.json();
      if(!response.ok){
        throw new Error(data.error.message || "Failed to generate response");
      }
      
      const apiResponse = data.candidiates[0].content.parts[0].text.replace(/^\n+/, '');
      //update chat history with the new bot response
      updateHistory(apiResponse);
    } catch (error) {
      console.log(error);
    }
  
  };

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
