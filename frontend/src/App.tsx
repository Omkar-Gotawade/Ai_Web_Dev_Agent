import { useState } from 'react'
import type { FormEvent } from 'react'

type MessageRole = 'user' | 'assistant'

interface ChatMessage {
  id: string
  role: MessageRole
  text: string
}

interface AgentActionResult {
  type?: string
  path?: string
}

interface GenerateResponse {
  success?: boolean
  error?: string
  actionsExecuted?: number
  actions?: AgentActionResult[]
  previewUrl?: string
}

function App() {
  const [prompt, setPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [previewUrl, setPreviewUrl] = useState('')

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

      const data = (await response.json()) as GenerateResponse

      if (!response.ok || !data.success) {
        const errorMessage = data.error ?? 'Request failed'
        throw new Error(errorMessage)
      }

      if (typeof data.previewUrl === 'string' && data.previewUrl.trim() !== '') {
        setPreviewUrl(`${data.previewUrl}?t=${Date.now()}`)
      }

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: 'Your website created successfully.',
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

  const handleRefreshPreview = () => {
    if (!previewUrl) {
      return
    }

    const baseUrl = previewUrl.split('?')[0]
    setPreviewUrl(`${baseUrl}?t=${Date.now()}`)
  }

  const handleOpenPreview = () => {
    if (!previewUrl) {
      return
    }

    window.open(previewUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-gray-800">
      <section className="flex w-2/5 flex-col bg-gray-900 p-4 text-white" aria-label="Chat interface">
        <header className="mb-4 border-b border-gray-700 pb-4">
          <h1 className="text-xl font-semibold">Prompt Chat</h1>
          <p className="mt-1 text-sm text-gray-300">Send prompts and preview output instantly.</p>
        </header>

        <ul className="mb-4 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
          {messages.length === 0 && (
            <li className="rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-gray-300">
              No messages yet. Start by entering a prompt below.
            </li>
          )}

          {messages.map((message) => (
            <li key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[90%] rounded-xl border px-3 py-2 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'border-blue-400 bg-blue-500 text-white'
                    : 'border-gray-700 bg-gray-800 text-gray-100'
                }`}
              >
                <p className="mb-1 text-xs uppercase tracking-wide opacity-80">
                  {message.role === 'user' ? 'You' : 'Agent'}
                </p>
                <p className="whitespace-pre-wrap break-words">{message.text}</p>
              </div>
            </li>
          ))}

          {isLoading && (
            <li className="flex justify-start" role="status">
              <div className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200">
                <p className="mb-1 text-xs uppercase tracking-wide opacity-80">Agent</p>
                <p>Generating...</p>
              </div>
            </li>
          )}
        </ul>

        <form className="mt-auto" onSubmit={handleSubmit}>
          <label htmlFor="prompt-input" className="sr-only">
            Enter your prompt
          </label>
          <div className="flex gap-2">
            <input
              id="prompt-input"
              type="text"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask for a website..."
              disabled={isLoading}
              className="min-w-0 flex-1 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-400 outline-none ring-blue-500 transition focus:ring-2 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isLoading || prompt.trim().length === 0}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-900"
            >
              {isLoading ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>
      </section>

      <section className="flex w-3/5 flex-col bg-gray-100 p-2" aria-label="Live website preview">
        <div className="mb-2 flex items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2">
          <p className="text-sm font-medium text-gray-700">Live Preview</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRefreshPreview}
              disabled={!previewUrl}
              className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Refresh Preview
            </button>
            <button
              type="button"
              onClick={handleOpenPreview}
              disabled={!previewUrl}
              className="rounded-md bg-gray-800 px-3 py-1 text-xs font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open in new tab
            </button>
          </div>
        </div>

        <div className="relative flex-1 overflow-hidden rounded-xl border border-gray-300 bg-white">
          {previewUrl ? (
            <iframe
              title="Website Preview"
              src={previewUrl}
              className="h-full w-full rounded-xl border-0"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-500">
              {isLoading
                ? 'Generating...'
                : 'No preview available yet. Ask the agent to create and preview a website.'}
            </div>
          )}

          {isLoading && previewUrl && (
            <div className="absolute inset-x-0 top-0 bg-black/40 px-3 py-1 text-center text-xs font-medium text-white">
              Generating...
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
