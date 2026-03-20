import React, { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Loader2, MessageSquare, Sparkles } from 'lucide-react';
import { api } from '../utils/api';

export default function CopilotPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async () => {
    const q = input.trim();
    if (!q || loading) return;

    const userMsg = { role: 'user', content: q };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = messages.slice(-10);
      const { answer } = await api.askCopilot(q, history);
      setMessages(prev => [...prev, { role: 'assistant', content: answer }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const suggestions = [
    'How many open issues are there?',
    'What is the total spending this month?',
    'List all tenants at 52 Old Elvet',
    'Who is our plumber?',
  ];

  return (
    <>
      {/* Toggle button */}
      <button className="copilot-toggle" onClick={() => setOpen(!open)} title="AI Copilot">
        {open ? <X size={20} /> : <Bot size={20} />}
      </button>

      {/* Panel */}
      {open && (
        <div className="copilot-panel">
          <div className="copilot-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="copilot-header-icon">
                <Sparkles size={14} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>AI Copilot</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Ask anything about your data</div>
              </div>
            </div>
            <button className="copilot-close" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>

          <div className="copilot-messages">
            {messages.length === 0 && (
              <div className="copilot-welcome">
                <div className="copilot-welcome-icon">
                  <MessageSquare size={24} />
                </div>
                <h4>Welcome to PSB Copilot</h4>
                <p>Ask me anything about your properties, tenants, issues, spending, or contractors.</p>
                <div className="copilot-suggestions">
                  {suggestions.map((s, i) => (
                    <button key={i} className="copilot-suggestion" onClick={() => { setInput(s); inputRef.current?.focus(); }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`copilot-message ${msg.role}`}>
                {msg.role === 'assistant' && (
                  <div className="copilot-message-avatar">
                    <Bot size={12} />
                  </div>
                )}
                <div className="copilot-message-content">
                  {msg.content.split('\n').map((line, j) => (
                    <React.Fragment key={j}>
                      {line}
                      {j < msg.content.split('\n').length - 1 && <br />}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ))}

            {loading && (
              <div className="copilot-message assistant">
                <div className="copilot-message-avatar">
                  <Bot size={12} />
                </div>
                <div className="copilot-typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="copilot-input-area">
            <textarea
              ref={inputRef}
              className="copilot-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question..."
              rows={1}
              disabled={loading}
            />
            <button className="copilot-send" onClick={handleSend} disabled={!input.trim() || loading}>
              {loading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
