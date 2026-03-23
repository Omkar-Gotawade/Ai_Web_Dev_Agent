import { useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type MessageRole = 'user' | 'assistant'

interface ChatMessage {
  id: string
  role: MessageRole
  text: string
}

function App() {
  const [prompt, setPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || isLoading) {
      return
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: trimmedPrompt,
    }

    setMessages((prev) => [...prev, userMessage])
    setPrompt('')
    setIsLoading(true)

    try {
      const response = await fetch('http://localhost:5000/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: trimmedPrompt }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        const errorMessage = data.error ?? 'Request failed'
        throw new Error(errorMessage)
      }

      const createdFiles = Array.isArray(data.files) ? data.files.join(', ') : 'none'
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: `Done. Created ${data.filesCreated ?? 0} file(s): ${createdFiles}`,
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }

      setMessages((prev) => [...prev, assistantMessage])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="chat-shell">
      <section className="chat-card" aria-label="Chat interface">
        <header className="chat-header">
          <h1>Prompt Chat</h1>
          <p>Send a prompt to the backend generator.</p>
        </header>

        <ul className="message-list" aria-live="polite">
          {messages.length === 0 && (
            <li className="empty-state">No messages yet. Start by entering a prompt below.</li>
          )}

          {messages.map((message) => (
            <li key={message.id} className={`message-item ${message.role}`}>
              <span className="message-role">{message.role === 'user' ? 'You' : 'Server'}</span>
              <p>{message.text}</p>
            </li>
          ))}

          {isLoading && (
            <li className="message-item assistant loading" role="status">
              <span className="message-role">Server</span>
              <p>Generating response...</p>
            </li>
          )}
        </ul>

        <form className="input-row" onSubmit={handleSubmit}>
          <label htmlFor="prompt-input" className="sr-only">
            Enter your prompt
          </label>
          <input
            id="prompt-input"
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask for a website..."
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading || prompt.trim().length === 0}>
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </form>
      </section>
    </main>
  )
}

export default App
