import { useState, useRef, useEffect } from 'react'

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const listRef = useRef(null)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  async function handleSubmit(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return

    setMessages((prev) => [...prev, { role: 'user', text }])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/llm-api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })

      const data = await res.json()

      if (res.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', text: data.reply }])
      } else {
        setMessages((prev) => [...prev, { role: 'error', text: data.error || 'Request failed' }])
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'error', text: `Network error: ${err.message}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="chat-widget">
      {!open && (
        <button
          className="chat-widget__toggle"
          onClick={() => setOpen(true)}
          aria-label="Open chat assistant"
        >
          💬
        </button>
      )}

      {open && (
        <div className="chat-widget__panel" role="dialog" aria-label="Chat assistant">
          <header className="chat-widget__header">
            <span>AI Assistant</span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat assistant"
              className="chat-widget__close"
            >
              ✕
            </button>
          </header>

          <div className="chat-widget__messages" ref={listRef}>
            {messages.length === 0 && (
              <p className="chat-widget__empty">Ask me to create tasks, check status, or anything else!</p>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`chat-widget__msg chat-widget__msg--${msg.role}`}>
                {msg.text}
              </div>
            ))}
            {loading && <div className="chat-widget__msg chat-widget__msg--loading">Thinking…</div>}
          </div>

          <form className="chat-widget__form" onSubmit={handleSubmit}>
            <input
              type="text"
              className="chat-widget__input"
              placeholder="Type a message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              aria-label="Chat message input"
            />
            <button type="submit" className="chat-widget__send" disabled={loading || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
