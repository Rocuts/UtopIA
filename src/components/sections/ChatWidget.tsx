'use client';

import { useState, useRef, useEffect } from 'react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { Mic, Send, Bot, User, ShieldAlert, Trash2, Paperclip, FileText, CheckCircle, Loader2, Globe, FileDown, PhoneOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { useLanguage } from '@/context/LanguageContext';
import { useRealtimeAPI } from '@/hooks/useRealtimeAPI';
import { RiskGauge } from '@/components/ui/RiskGauge';
import {
  saveConversation,
  generateConversationId,
  inferTitle,
  type RiskLevel,
} from '@/lib/storage/conversation-history';
import { exportConversationPDF } from '@/lib/export/pdf-export';
import { Canvas } from '@react-three/fiber';
import { Environment, ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { InteractiveOrb } from '@/components/ui/InteractiveOrb';

const NOVA_SPRING = { stiffness: 400, damping: 25 };

const generateId = () => {
  try {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
  } catch (err) {
    // Ignore and use fallback
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  webSearchUsed?: boolean;
  riskAssessment?: {
    level: RiskLevel;
    score: number;
    factors: { description: string; severity: string }[];
    recommendations: string[];
  };
}

const INITIAL_MSG = {
  es: 'Bienvenido a UtopIA. Soy su asistente especializado en consultoría contable y tributaria colombiana. ¿En qué puedo ayudarle hoy?',
  en: 'Welcome to UtopIA. I am your assistant specialized in Colombian accounting and tax consulting. How can I help you today?',
};

export function ChatWidget() {
  const { language, t } = useLanguage();
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: '1', role: 'assistant', content: INITIAL_MSG[language] }]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [useCase, setUseCase] = useState('dian-defense');
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [conversationId] = useState(() => generateConversationId());
  const [latestRiskAssessment, setLatestRiskAssessment] = useState<ChatMessage['riskAssessment'] | null>(null);

  const { isConnecting, isConnected, error, volume, startSession, stopSession, messageLog } = useRealtimeAPI();

  const useCaseLabels = {
    es: {
      'dian-defense': 'Defensa DIAN',
      'tax-refund': 'Devolución de Saldos',
      'due-diligence': 'Due Diligence',
      'financial-intelligence': 'Inteligencia Financiera',
    },
    en: {
      'dian-defense': 'DIAN Defense',
      'tax-refund': 'Tax Refund',
      'due-diligence': 'Due Diligence',
      'financial-intelligence': 'Financial Intelligence',
    },
  };

  useEffect(() => {
    if (messages.length === 1 && messages[0].role === 'assistant') {
      setMessages([{ id: '1', role: 'assistant', content: INITIAL_MSG[language] }]);
    }
  }, [language]);

  const scrollToBottom = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  useEffect(() => {
    const timer = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timer);
  }, [messages]);

  const simulateResponse = async (newMessages: ChatMessage[]) => {
    setIsTyping(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, language, useCase }),
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const data = await response.json();

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: data.content,
        webSearchUsed: data.webSearchUsed || false,
        riskAssessment: data.riskAssessment ?? undefined,
      };

      if (data.riskAssessment) {
        setLatestRiskAssessment(data.riskAssessment);
      }

      setMessages(prev => {
        const updated = [...prev, assistantMsg];
        saveConversation({
          id: conversationId,
          title: inferTitle(updated),
          useCase,
          messages: updated.map(m => ({ id: m.id, role: m.role, content: m.content, webSearchUsed: m.webSearchUsed })),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          riskLevel: data.riskAssessment?.level ?? 'bajo',
        });
        return updated;
      });
    } catch (error) {
      console.error("Error consultando al agente:", error);
      setMessages(prev => [
        ...prev,
        { id: generateId(), role: 'assistant', content: t.chatAi.errorMsg }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg: ChatMessage = { id: generateId(), role: 'user', content: input };
    const newMessages = [...messages, userMsg];

    setMessages(newMessages);
    setInput('');
    simulateResponse(newMessages.map(m => ({ id: m.id, role: m.role, content: m.content })));
  };

  const toggleRecording = () => {
    if (voiceMode) {
      stopSession();
      setVoiceMode(false);
    } else {
      startSession();
      setVoiceMode(true);
    }
  };

  const handleClearChat = () => {
    setMessages([{ id: generateId(), role: 'assistant', content: INITIAL_MSG[language] }]);
    setLatestRiskAssessment(null);
  };

  const useCaseLabelsForExport: Record<string, string> = {
    'dian-defense': language === 'es' ? 'Defensa DIAN' : 'DIAN Defense',
    'tax-refund': language === 'es' ? 'Devolución de Saldos' : 'Tax Refund',
    'due-diligence': language === 'es' ? 'Due Diligence' : 'Due Diligence',
    'financial-intelligence': language === 'es' ? 'Inteligencia Financiera' : 'Financial Intelligence',
  };

  const handleExportPDF = () => {
    if (messages.length <= 1) return;
    exportConversationPDF({
      title: inferTitle(messages),
      useCase: useCaseLabelsForExport[useCase] ?? useCase,
      messages: messages.map(m => ({ id: m.id, role: m.role, content: m.content, webSearchUsed: m.webSearchUsed })),
      language,
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('context', file.name);

    try {
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Upload failed');

      setUploadedFiles(prev => [...prev, file.name]);
      setMessages(prev => [
        ...prev,
        {
          id: generateId(),
          role: 'assistant',
          content: language === 'es'
            ? `He procesado su documento **"${file.name}"** (${data.chunks} fragmentos). Ahora puedo responder preguntas basadas en su contenido. ¿Qué desea consultar?`
            : `I've processed your document **"${file.name}"** (${data.chunks} chunks). I can now answer questions based on its content. What would you like to know?`,
        },
      ]);
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id: generateId(),
          role: 'assistant',
          content: language === 'es'
            ? 'No pude procesar el archivo. Verifica el formato e intenta de nuevo.'
            : 'Could not process the file. Please check the format and try again.',
        },
      ]);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <section id="ai-consult" className="py-16 md:py-24 relative container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl">
      <div className="text-center mb-10">
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4 text-[#0a0a0a]">
          {t.chat.title}
        </h2>
        <p className="text-lg text-[#525252] mb-4">
          {t.chat.confidential}
        </p>
        <div className="flex items-center justify-center gap-2 text-sm text-[#525252] bg-[#fafafa] w-fit mx-auto px-4 py-2 rounded-sm border border-[#e5e5e5]">
          <ShieldAlert className="w-4 h-4" />
          <span>{t.chat.demoTag}</span>
        </div>
      </div>

      <GlassPanel className="flex flex-col h-[600px] overflow-hidden rounded-sm relative z-10 bg-white">

        {!hasAcceptedTerms && (
          <div className="absolute inset-0 z-50 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
            <div className="max-w-md p-8 border border-[#e5e5e5] bg-white rounded-sm">
              <ShieldAlert className="w-10 h-10 text-[#0a0a0a] mx-auto mb-4" />
              <h3 className="text-lg font-bold mb-4 text-[#0a0a0a]">{t.chatAi.disclaimerTitle}</h3>
              <p className="text-sm text-[#525252] mb-6 leading-relaxed">
                {t.chatAi.disclaimerText}
              </p>
              <Button onClick={() => setHasAcceptedTerms(true)} className="w-full">
                {t.chatAi.acceptBtn}
              </Button>
            </div>
          </div>
        )}

        {/* Chat Header */}
        <div className="p-4 border-b border-[#e5e5e5] flex items-center justify-between bg-white z-20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-sm bg-[#0a0a0a] flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-medium text-[#0a0a0a] text-sm">UtopIA</h3>
              <p className="text-xs text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
                {voiceMode ? (isConnecting ? t.chatAi.voiceConnecting : t.chatAi.voiceListening) : t.chatAi.status}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={useCase}
              onChange={(e) => setUseCase(e.target.value)}
              className="hidden md:block bg-white border border-[#e5e5e5] text-[#0a0a0a] text-xs rounded-sm px-2 py-1 outline-none focus:border-[#0a0a0a]"
            >
              {Object.entries(useCaseLabels[language]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <Button onClick={handleExportPDF} variant="ghost" size="sm" className="hidden md:inline-flex text-xs" disabled={messages.length <= 1}>
              <FileDown className="w-3.5 h-3.5 mr-1.5" />
              PDF
            </Button>
            <Button onClick={handleClearChat} variant="ghost" size="sm" className="hidden md:inline-flex text-xs text-[#ef4444] hover:text-[#ef4444] hover:bg-[#fef2f2]">
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              {t.chatAi.clear}
            </Button>
          </div>
        </div>

        {/* Uploaded files indicator */}
        {uploadedFiles.length > 0 && (
          <div className="px-4 py-2 border-b border-[#e5e5e5] bg-[#fafafa] flex items-center gap-2 flex-wrap z-20">
            <FileText className="w-3.5 h-3.5 text-[#525252] shrink-0" />
            <span className="text-xs text-[#a3a3a3]">
              {language === 'es' ? 'Documentos cargados:' : 'Loaded documents:'}
            </span>
            {uploadedFiles.map((name, i) => (
              <span key={i} className="text-xs bg-white text-[#0a0a0a] px-2 py-0.5 rounded-sm border border-[#e5e5e5] flex items-center gap-1">
                <CheckCircle className="w-3 h-3 text-[#22c55e]" />
                {name}
              </span>
            ))}
          </div>
        )}

        {/* Dynamic Main View: Text Chat vs Voice Orb */}
        {voiceMode ? (
          <div data-lenis-prevent className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 bg-[#fafafa] overflow-y-auto">
                <div className="w-full h-[350px] mb-6 relative rounded-sm overflow-hidden bg-[#0a0a0a] border border-[#e5e5e5]">
                  <Canvas camera={{ position: [0, 0, 5], fov: 45 }} gl={{ antialias: false }}>
                    <color attach="background" args={['#0a0a0a']} />
                    <ambientLight intensity={0.1} />
                    <directionalLight position={[10, 10, 5]} intensity={1} color="#ffffff" />
                    <directionalLight position={[-10, -10, -5]} intensity={2} color="#d4a017" />
                    <pointLight position={[0, 0, 2]} intensity={0.5} color="#d4a017" />

                    <InteractiveOrb volume={volume} isConnected={isConnected} isConnecting={isConnecting} />

                    <Environment preset="night" />

                    <EffectComposer enableNormalPass={false} multisampling={0}>
                      <Bloom
                        luminanceThreshold={0.5}
                        luminanceSmoothing={0.3}
                        intensity={2.0}
                        mipmapBlur
                      />
                    </EffectComposer>
                  </Canvas>
                </div>

                <div className="text-center w-full max-w-sm">
                  <h4 className="text-lg font-bold mb-2 text-[#0a0a0a]">
                    {isConnecting ? t.chatAi.voiceConnectingTitle : t.chatAi.voiceTitle}
                  </h4>
                  <p className="text-sm text-[#525252] mb-6 min-h-[40px]">
                    {error ? <span className="text-[#ef4444]">{error}</span> :
                     isConnected ? t.chatAi.voiceActive :
                     t.chatAi.voiceMicPermission}
                  </p>

                  <div className="h-12 overflow-hidden mb-6 flex flex-col justify-end text-xs font-[family-name:var(--font-geist-mono)] text-[#a3a3a3]">
                    <AnimatePresence>
                      {messageLog.slice(-2).map((log, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ type: "spring", ...NOVA_SPRING }}
                        >
                          {'>'} {log}
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>

                  <Button
                    onClick={toggleRecording}
                    className="rounded-sm w-14 h-14 bg-[#ef4444] text-white hover:bg-[#dc2626] mx-auto flex items-center justify-center"
                  >
                    <PhoneOff className="w-5 h-5" />
                  </Button>
                </div>
          </div>
        ) : (
          <div
            ref={scrollContainerRef}
            data-lenis-prevent
            className="flex-1 min-h-0 overflow-y-auto styled-scrollbar bg-white"
            style={{ overscrollBehavior: 'contain' }}
          >
            <div className="p-4 sm:p-6 flex flex-col gap-4 w-full">
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", ...NOVA_SPRING }}
                    className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    <div className={`w-7 h-7 rounded-sm flex items-center justify-center shrink-0 mt-0.5 ${
                      msg.role === 'user' ? 'bg-[#fafafa] border border-[#e5e5e5] text-[#525252]' : 'bg-[#0a0a0a] text-white'
                    }`}>
                      {msg.role === 'user' ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                    </div>
                    <div className={`max-w-[85%] sm:max-w-[80%] rounded-sm px-4 py-3 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[#0a0a0a] text-white'
                        : 'bg-[#fafafa] border border-[#e5e5e5] text-[#0a0a0a] prose max-w-none'
                    }`}>
                      {msg.role === 'user' ? (
                        msg.content
                      ) : (
                        <>
                          {msg.webSearchUsed && (
                            <div className="flex items-center gap-1.5 text-xs text-[#525252] mb-2 pb-2 border-b border-[#e5e5e5]">
                              <Globe className="w-3.5 h-3.5" />
                              <span className="font-medium font-[family-name:var(--font-geist-mono)]">
                                {language === 'es' ? 'Información complementada con búsqueda web' : 'Enhanced with web search'}
                              </span>
                            </div>
                          )}
                          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                            {msg.content}
                          </ReactMarkdown>
                          {msg.riskAssessment && (
                            <div className="mt-4 pt-4 border-t border-[#e5e5e5] flex flex-col items-center gap-2">
                              <RiskGauge
                                level={msg.riskAssessment.level}
                                score={msg.riskAssessment.score}
                                className="scale-90"
                              />
                              {msg.riskAssessment.factors.length > 0 && (
                                <ul className="text-xs text-[#525252] list-disc list-inside mt-2 space-y-1 w-full">
                                  {msg.riskAssessment.factors.slice(0, 3).map((f, i) => (
                                    <li key={i}>{f.description}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </motion.div>
                ))}

                {isTyping && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ type: "spring", ...NOVA_SPRING }}
                    className="flex gap-3"
                  >
                    <div className="w-7 h-7 rounded-sm bg-[#0a0a0a] flex items-center justify-center shrink-0 mt-0.5 text-white">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                    <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-sm px-4 py-3 flex items-center gap-1.5 self-start">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#a3a3a3] animate-bounce" />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#a3a3a3] animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#a3a3a3] animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </motion.div>
                )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* Chat Input */}
        {!voiceMode && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", ...NOVA_SPRING }}
            className="p-4 bg-white border-t border-[#e5e5e5] relative z-20"
          >
            <form
              onSubmit={handleSubmit}
              className="flex items-end gap-2 bg-white border border-[#e5e5e5] rounded-sm p-1.5 focus-within:border-[#0a0a0a] transition-colors"
            >
              <button
                type="button"
                onClick={toggleRecording}
                className="p-2.5 rounded-sm flex items-center justify-center shrink-0 transition-colors text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa]"
                title={t.chatAi.voiceButtonTitle}
              >
                <Mic className="w-4 h-4" />
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.csv,.json,.xml,.pdf,.xlsx"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="p-2.5 rounded-sm flex items-center justify-center shrink-0 transition-colors text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa] disabled:opacity-50"
                title={language === 'es' ? 'Subir documento' : 'Upload document'}
              >
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
              </button>

              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t.chat.inputPlaceholder}
                className="flex-1 bg-transparent border-none focus:ring-0 text-[#0a0a0a] text-sm resize-none py-2.5 px-2 outline-none min-h-[40px] max-h-[120px] placeholder:text-[#a3a3a3]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
              />

              <button
                type="submit"
                disabled={!input.trim()}
                className="p-2.5 rounded-sm bg-[#0a0a0a] text-white shrink-0 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#262626] transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
            <p className="text-center text-xs text-[#a3a3a3] mt-3 font-[family-name:var(--font-geist-mono)]">
               {t.chat.disclaimer}
            </p>
          </motion.div>
        )}

      </GlassPanel>
    </section>
  );
}
