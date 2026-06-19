// Session-id helpers for the chat widget.
//
// The id logic is factored out of ChatWidget.jsx so it can be unit-tested
// without rendering React or relying on the real browser sessionStorage.
// Storage is passed in (defaulting to the real sessionStorage in the browser),
// which keeps these functions pure and injectable in tests.

export const SESSION_KEY = "llm-chat-session-id";

// Generate a fresh session id, preferring crypto.randomUUID when available and
// falling back to a timestamp+random token in environments that lack it.
export function generateSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Return the stored session id, minting and persisting one on first contact.
export function loadOrCreateSessionId(storage) {
  let id = storage.getItem(SESSION_KEY);
  if (!id) {
    id = generateSessionId();
    storage.setItem(SESSION_KEY, id);
  }
  return id;
}

// Replace the current session with a brand-new id (used by "new conversation").
export function resetSessionId(storage) {
  const id = generateSessionId();
  storage.setItem(SESSION_KEY, id);
  return id;
}
