import { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, ChevronDown, ChevronRight, Wrench, Loader2, Sparkles, User, Maximize2, Minimize2, Zap, BarChart3, Bot, BookOpen, Database, FlaskConical } from 'lucide-react';
import { chatWithAssistant } from '../api/client';
import ChatMarkdown from './ChatMarkdown';

const TOOL_META = {
  list_trained_models:    { label: 'Listed trained models',     icon: Bot },
  get_model_details:      { label: 'Fetched model details',     icon: Bot },
  get_episode_kpis:       { label: 'Analyzed KPIs',             icon: BarChart3 },
  get_episode_summary:    { label: 'Summarized episode data',   icon: BarChart3 },
  compare_models:         { label: 'Compared models',           icon: Zap },
  get_building_info:      { label: 'Loaded building specs',     icon: Database },
  get_dataset_info:       { label: 'Fetched dataset info',      icon: Database },
  explain_citylearn:      { label: 'Explained CityLearn',       icon: BookOpen },
  explain_algorithm:      { label: 'Explained algorithm',       icon: FlaskConical },
  get_baseline_comparison:{ label: 'Compared with baseline',    icon: Zap },
};

// Keep a simple lookup for the right sidebar
const TOOL_LABELS = Object.fromEntries(
  Object.entries(TOOL_META).map(([k, v]) => [k, v.label])
);

function ToolCallCard({ toolCall }) {
  const meta = TOOL_META[toolCall.name] || { label: toolCall.name, icon: Wrench };
  const Icon = meta.icon;

  return (
    <div className="chat-tool-card flex items-center gap-2 px-3 py-2">
      <Icon size={14} className="text-indigo-500 shrink-0" />
      <span className="text-xs font-medium text-slate-600">{meta.label}</span>
    </div>
  );
}

function MessageBubble({ message, fullscreen }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`shrink-0 rounded-full flex items-center justify-center mt-0.5 ${
        fullscreen ? 'w-8 h-8' : 'w-7 h-7'
      } ${isUser ? 'bg-indigo-100' : 'bg-gradient-to-br from-indigo-500 to-purple-600'}`}>
        {isUser
          ? <User size={fullscreen ? 16 : 14} className="text-indigo-600" />
          : <Sparkles size={fullscreen ? 16 : 14} className="text-white" />}
      </div>
      <div className={`flex flex-col gap-1.5 min-w-0 ${
        fullscreen ? 'max-w-[75%]' : 'max-w-[85%]'
      } ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Tool calls rendered before the response */}
        {!isUser && message.tool_calls?.length > 0 && (
          <div className="w-full space-y-1.5 mb-1">
            {message.tool_calls.map((tc, i) => (
              <ToolCallCard key={i} toolCall={tc} />
            ))}
          </div>
        )}
        <div className={`rounded-2xl leading-relaxed ${
          fullscreen ? 'px-4 py-3 text-[15px]' : 'px-3.5 py-2.5 text-sm'
        } ${isUser
            ? 'bg-indigo-600 text-white rounded-br-md'
            : 'bg-white border border-slate-200 text-slate-800 rounded-bl-md shadow-sm'
        }`}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <ChatMarkdown content={message.content} />
          )}
        </div>
      </div>
    </div>
  );
}

function ThinkingIndicator({ fullscreen }) {
  return (
    <div className="flex gap-3">
      <div className={`shrink-0 rounded-full flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 ${
        fullscreen ? 'w-8 h-8' : 'w-7 h-7'
      }`}>
        <Sparkles size={fullscreen ? 16 : 14} className="text-white" />
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader2 size={14} className="animate-spin" />
          <span>Thinking...</span>
        </div>
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  'What models are available?',
  'Explain the CityLearn environment',
  'How does MARLISA work?',
  'Compare all models on 3 buildings',
  'Analyze KPIs for the best model',
  'How does SAC differ from MAPPO?',
];

export default function ChatPanel({ mode, onClose, onToggleMode }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const isFullscreen = mode === 'fullscreen';
  const isPopup = mode === 'popup';
  const isOpen = mode !== null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const sendMessage = async (text) => {
    const content = text || input.trim();
    if (!content || loading) return;

    const userMsg = { role: 'user', content };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const result = await chatWithAssistant(newMessages);
      setMessages([...newMessages, {
        role: 'assistant',
        content: result.content,
        tool_calls: result.tool_calls || [],
      }]);
    } catch (err) {
      setMessages([...newMessages, {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${err.message}`,
        tool_calls: [],
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const emptyState = (
    <div className={`flex flex-col items-center justify-center h-full text-center ${isFullscreen ? 'px-8' : 'px-4'}`}>
      <div className={`rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center mb-4 ${
        isFullscreen ? 'w-16 h-16' : 'w-12 h-12'
      }`}>
        <Sparkles size={isFullscreen ? 32 : 24} className="text-indigo-500" />
      </div>
      <h4 className={`font-semibold text-slate-800 mb-1 ${isFullscreen ? 'text-xl' : 'text-sm'}`}>
        CityLearn AI Assistant
      </h4>
      <p className={`text-slate-500 mb-5 leading-relaxed max-w-lg ${isFullscreen ? 'text-sm' : 'text-xs'}`}>
        I can explain RL algorithms, analyze KPIs, compare trained models,
        inspect building configurations, and help you understand the CityLearn environment.
      </p>
      <div className={`flex flex-wrap gap-2 justify-center ${isFullscreen ? 'max-w-2xl' : ''}`}>
        {(isFullscreen ? SUGGESTIONS : SUGGESTIONS.slice(0, 4)).map((s) => (
          <button
            key={s}
            onClick={() => sendMessage(s)}
            className={`rounded-full border border-indigo-200 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-300 transition-colors ${
              isFullscreen ? 'text-sm px-4 py-2' : 'text-[11px] px-2.5 py-1.5'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );

  const chatHeader = (
    <div className={`flex items-center gap-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white shrink-0 ${
      isFullscreen ? 'px-6 py-4' : 'px-4 py-3'
    }`}>
      <div className={`rounded-full bg-white/20 flex items-center justify-center ${
        isFullscreen ? 'w-10 h-10' : 'w-8 h-8'
      }`}>
        <Sparkles size={isFullscreen ? 20 : 16} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className={`font-semibold ${isFullscreen ? 'text-base' : 'text-sm'}`}>AI Assistant</h3>
        <p className={`text-indigo-200 ${isFullscreen ? 'text-xs' : 'text-[11px]'}`}>CityLearn RL Expert</p>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onToggleMode}
          className="w-8 h-8 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
          title={isFullscreen ? 'Minimize to popup' : 'Expand fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );

  const messagesArea = (
    <div className={`flex-1 overflow-y-auto space-y-4 chat-messages ${
      isFullscreen ? 'p-6' : 'p-4'
    }`}>
      {messages.length === 0 && !loading ? emptyState : (
        <>
          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} fullscreen={isFullscreen} />
          ))}
          {loading && <ThinkingIndicator fullscreen={isFullscreen} />}
        </>
      )}
      <div ref={messagesEndRef} />
    </div>
  );

  const inputArea = (
    <div className={`shrink-0 border-t border-slate-200 bg-white ${isFullscreen ? 'p-4' : 'p-3'}`}>
      <div className={`flex items-end gap-2 ${isFullscreen ? 'max-w-4xl mx-auto' : ''}`}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about models, KPIs, algorithms..."
          rows={isFullscreen ? 2 : 1}
          className={`flex-1 resize-none rounded-xl border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-slate-50 ${
            isFullscreen ? 'px-4 py-3 text-[15px] max-h-32' : 'px-3.5 py-2.5 text-sm max-h-24'
          }`}
          disabled={loading}
        />
        <button
          onClick={() => sendMessage()}
          disabled={!input.trim() || loading}
          className={`shrink-0 bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
            isFullscreen ? 'w-12 h-12 rounded-xl' : 'w-10 h-10 rounded-xl'
          }`}
        >
          <Send size={isFullscreen ? 18 : 16} />
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Floating trigger button — only when fully closed */}
      {!isOpen && (
        <button
          onClick={() => onToggleMode()}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-300 hover:scale-105 transition-all flex items-center justify-center group"
          title="Open AI Assistant"
        >
          <Sparkles size={24} className="group-hover:rotate-12 transition-transform" />
        </button>
      )}

      {/* Popup mode */}
      {isPopup && (
        <div className="fixed bottom-6 right-6 z-50 w-[420px] h-[600px] flex flex-col bg-slate-50 rounded-2xl shadow-2xl shadow-slate-300/50 border border-slate-200 overflow-hidden chat-panel-enter">
          {chatHeader}
          {messagesArea}
          {inputArea}
        </div>
      )}

      {/* Fullscreen mode — 3-column layout with sidebars */}
      {isFullscreen && (
        <div className="flex-1 flex overflow-hidden bg-slate-50 chat-panel-enter">

          {/* Left sidebar — capabilities & info */}
          <div className="w-[280px] shrink-0 border-r border-slate-200 bg-white p-5 overflow-y-auto flex flex-col gap-5">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                  <Sparkles size={14} className="text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">AI Assistant</h3>
                  <p className="text-[10px] text-slate-400">Powered by Gemini 2.5 Flash</p>
                </div>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Your expert guide to the CityLearn RL platform. Ask about models, algorithms, KPIs, building configurations, and more.
              </p>
            </div>

            <div className="w-full h-px bg-slate-100" />

            <div>
              <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Capabilities</h4>
              <div className="space-y-2">
                {[
                  { icon: Bot, label: 'Model Explorer', desc: 'List & inspect trained models' },
                  { icon: BarChart3, label: 'KPI Analysis', desc: 'Analyze performance metrics' },
                  { icon: FlaskConical, label: 'Algorithm Expert', desc: 'Explain SAC, MAPPO, MARLISA' },
                  { icon: Database, label: 'Dataset Inspector', desc: 'Browse building & dataset info' },
                  { icon: Zap, label: 'Model Comparison', desc: 'Compare agents & baselines' },
                  { icon: BookOpen, label: 'Environment Guide', desc: 'Explain CityLearn concepts' },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 transition-colors">
                    <Icon size={14} className="text-indigo-500 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-slate-700">{label}</div>
                      <div className="text-[11px] text-slate-400">{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="w-full h-px bg-slate-100" />

            <div>
              <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Quick Actions</h4>
              <div className="space-y-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg border border-slate-150 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Center — chat area */}
          <div className="flex-1 flex flex-col min-w-0">
            {messagesArea}
            {inputArea}
          </div>

          {/* Right sidebar — tool activity log */}
          <div className="w-[280px] shrink-0 border-l border-slate-200 bg-white p-5 overflow-y-auto">
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Tool Activity</h4>
            {messages.some(m => m.tool_calls?.length > 0) ? (
              <div className="space-y-2">
                {messages.filter(m => m.tool_calls?.length > 0).flatMap((m, mi) =>
                  m.tool_calls.map((tc, ti) => (
                    <div key={`${mi}-${ti}`} className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                      <div className="flex items-center gap-2 mb-1">
                        <Wrench size={12} className="text-indigo-500" />
                        <span className="text-xs font-medium text-slate-700">{TOOL_LABELS[tc.name] || tc.name}</span>
                      </div>
                      {tc.args && Object.keys(tc.args).length > 0 && (
                        <div className="text-[10px] text-slate-400 font-mono truncate">
                          {Object.entries(tc.args).map(([k, v]) => `${k}: ${v}`).join(', ')}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-12">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mb-3">
                  <Wrench size={18} className="text-slate-300" />
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Tool calls will appear here as the assistant retrieves data and analyzes your models.
                </p>
              </div>
            )}

            {messages.length > 0 && (
              <>
                <div className="w-full h-px bg-slate-100 my-4" />
                <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Session</h4>
                <div className="space-y-1.5 text-[11px] text-slate-500">
                  <div className="flex justify-between">
                    <span>Messages</span>
                    <span className="font-medium text-slate-700">{messages.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tool calls</span>
                    <span className="font-medium text-slate-700">
                      {messages.reduce((sum, m) => sum + (m.tool_calls?.length || 0), 0)}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
