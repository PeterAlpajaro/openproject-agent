import React from 'react'
import ReactDOM from 'react-dom/client'
import ChatWidget from './ChatWidget'
import './widget.css'

ReactDOM.createRoot(document.getElementById('llm-chat-widget') || (() => {
  const el = document.createElement('div')
  el.id = 'llm-chat-widget'
  document.body.appendChild(el)
  return el
})()).render(
  <React.StrictMode>
    <ChatWidget />
  </React.StrictMode>,
)
