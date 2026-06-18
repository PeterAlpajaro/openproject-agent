import { useState, useRef, useEffect } from 'react'

// Persist a session id for the life of the browser tab so the conversation
// keeps its memory across messages (and page interactions within the tab).
function getSessionId() {
  const KEY = 'llm-chat-session-id'
  let id = sessionStorage.getItem(KEY)
  if (!id) {
    id =
      crypto.randomUUID?.() ??
      `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`
    sessionStorage.setItem(KEY, id)
  }
  return id
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const listRef = useRef(null)
  const sessionIdRef = useRef(getSessionId())

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
        body: JSON.stringify({ message: text, sessionId: sessionIdRef.current }),
      })

      const data = await res.json()

      if (res.ok) {
        // The server echoes back the session id (minting one on first contact).
        if (data.sessionId) {
          sessionIdRef.current = data.sessionId
          sessionStorage.setItem('llm-chat-session-id', data.sessionId)
        }
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

  async function handleReset() {
    const id = sessionIdRef.current
    setMessages([])
    try {
      await fetch(`/llm-api/chat/${encodeURIComponent(id)}`, { method: 'DELETE' })
    } catch {
      // Ignore — clearing local state is the important part.
    }
    // Start a fresh conversation with a new session id.
    const newId =
      crypto.randomUUID?.() ??
      `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`
    sessionIdRef.current = newId
    sessionStorage.setItem('llm-chat-session-id', newId)
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
            <div className="chat-widget__header-actions">
              <button
                onClick={handleReset}
                aria-label="Start a new conversation"
                title="New conversation"
                className="chat-widget__reset"
              >
                ⟲
              </button>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close chat assistant"
                className="chat-widget__close"
              >
                ✕
              </button>
            </div>
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
