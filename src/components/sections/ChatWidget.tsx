'use client';

import { useState, useRef, useEffect } from 'react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { Mic, Send, Bot, User, Volume2, ShieldAlert, Trash2, X, PhoneOff, Paperclip, FileText, CheckCircle, Loader2, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLanguage } from '@/context/LanguageContext';
import { useRealtimeAPI } from '@/hooks/useRealtimeAPI';
import { Canvas } from '@react-three/fiber';
import { Environment, ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { InteractiveOrb } from '@/components/ui/InteractiveOrb';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  webSearchUsed?: boolean;
}

const INITIAL_MSG = {
  es: 'Hola. Soy AiVocate, tu asistente de orientación legal laboral en Estados Unidos. ¿En qué puedo ayudarte hoy?',
  en: 'Hello. I am AiVocate, your U.S. labor law guidance assistant. How can I help you today?',
};

export function ChatWidget() {
  const { language, t } = useLanguage();
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: '1', role: 'assistant', content: INITIAL_MSG[language] }]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [jurisdiction, setJurisdiction] = useState('Federal');
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);

  // Initialize Realtime API hook
  const { isConnecting, isConnected, error, volume, startSession, stopSession, messageLog } = useRealtimeAPI();

  // Sync initial message if language changes globally and no chat happened
  useEffect(() => {
    if (messages.length === 1 && messages[0].role === 'assistant') {
      setMessages([{ id: '1', role: 'assistant', content: INITIAL_MSG[language] }]);
    }
  }, [language]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, messageLog]);

  const simulateResponse = async (newMessages: ChatMessage[]) => {
    setIsTyping(true);
    
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: newMessages, language, jurisdiction }),
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const data = await response.json();

      setMessages(prev => [
        ...prev,
        {
          id: Math.random().toString(),
          role: 'assistant',
          content: data.content,
          webSearchUsed: data.webSearchUsed || false,
        }
      ]);
    } catch (error) {
      console.error("Error consultando al agente:", error);
      setMessages(prev => [
        ...prev,
        {
          id: Math.random().toString(),
          role: 'assistant',
          content: t.chatAi.errorMsg
        }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg: ChatMessage = { id: Math.random().toString(), role: 'user', content: input };
    const newMessages = [...messages, userMsg];
    
    setMessages(newMessages);
    setInput('');
    simulateResponse(newMessages.map(m => ({ id: m.id, role: m.role, content: m.content })));
  };

  const toggleRecording = () => {
    if (voiceMode) {
      // Trying to stop voice
      stopSession();
      setVoiceMode(false);
    } else {
      // Trying to start voice
      startSession();
      setVoiceMode(true);
    }
  };

  const handleClearChat = () => {
    setMessages([{ id: Math.random().toString(), role: 'assistant', content: INITIAL_MSG[language] }]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('context', file.name);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setUploadedFiles(prev => [...prev, file.name]);
      setMessages(prev => [
        ...prev,
        {
          id: Math.random().toString(),
          role: 'assistant',
          content: language === 'es'
            ? `He procesado tu documento **"${file.name}"** (${data.chunks} fragmentos). Ahora puedo responder preguntas basadas en su contenido. ¿Qué te gustaría saber?`
            : `I've processed your document **"${file.name}"** (${data.chunks} chunks). I can now answer questions based on its content. What would you like to know?`,
        },
      ]);
    } catch (error: any) {
      setMessages(prev => [
        ...prev,
        {
          id: Math.random().toString(),
          role: 'assistant',
          content: language === 'es'
            ? `No pude procesar el archivo: ${error.message}`
            : `Could not process file: ${error.message}`,
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
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
          {t.chat.title.split(' ').map((word: string, i: number, arr: string[]) => 
            i === arr.length - 2 || i === arr.length - 1 ? <span key={i} className="text-gradient">{word} </span> : <span key={i}>{word} </span>
          )}
        </h2>
        <p className="text-lg text-foreground/70 mb-4">
          {t.chat.confidential}
        </p>
        <div className="flex items-center justify-center gap-2 text-sm text-[#f59e0b] bg-[#f59e0b]/10 w-fit mx-auto px-4 py-2 rounded-full border border-[#f59e0b]/20">
          <ShieldAlert className="w-4 h-4" />
          <span>{t.chat.demoTag}</span>
        </div>
      </div>

      <GlassPanel className="flex flex-col h-[600px] overflow-hidden rounded-2xl border-[var(--surface-border-solid)] shadow-[0_0_40px_rgba(0,229,255,0.05)] relative z-10 bg-[var(--background)]">
        
        {!hasAcceptedTerms && (
          <div className="absolute inset-0 z-50 bg-[var(--background)]/80 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
            <GlassPanel className="max-w-md p-8 border-[var(--surface-border-solid)] bg-[var(--surface-panel)] rounded-2xl shadow-xl">
              <ShieldAlert className="w-12 h-12 text-[#f59e0b] mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-4">{t.chatAi.disclaimerTitle}</h3>
              <p className="text-sm text-foreground/80 mb-6 leading-relaxed">
                {t.chatAi.disclaimerText}
              </p>
              <Button
                onClick={() => setHasAcceptedTerms(true)}
                className="w-full bg-[#00e5ff] text-[#0f172a] hover:bg-[#60a5fa] font-semibold"
              >
                {t.chatAi.acceptBtn}
              </Button>
            </GlassPanel>
          </div>
        )}

        {/* Chat Header */}
        <div className="p-4 border-b border-[var(--surface-border)] flex items-center justify-between bg-[var(--background)]/90 z-20">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full bg-[#0f172a] border border-[#00e5ff]/30 flex items-center justify-center relative transition-all ${voiceMode ? 'shadow-[0_0_15px_rgba(0,229,255,0.8)]' : ''}`}>
              <Bot className="w-5 h-5 text-[#00e5ff]" />
              <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--background)] ${isConnected ? 'bg-[#ec4899]' : 'bg-green-500'}`} />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-sm">AiVocate</h3>
              <p className="text-xs text-[#00e5ff]">{voiceMode ? (isConnecting ? t.chatAi.voiceConnecting : t.chatAi.voiceListening) : t.chatAi.status}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <select 
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              className="hidden md:block bg-[var(--surface-panel)] border border-[var(--surface-border-solid)] text-foreground text-xs rounded-md px-2 py-1 outline-none focus:border-[#00e5ff]/50"
            >
              <option value="Federal">Federal (Default)</option>
              <option value="California">California (CA)</option>
              <option value="Texas">Texas (TX)</option>
              <option value="New York">New York (NY)</option>
              <option value="Florida">Florida (FL)</option>
            </select>
            <Button onClick={handleClearChat} variant="ghost" size="sm" className="hidden md:inline-flex text-xs text-red-400 hover:text-red-300 border border-transparent hover:border-red-500/30">
              <Trash2 className="w-4 h-4 mr-2" />
              {t.chatAi.clear}
            </Button>
          </div>
        </div>

        {/* Uploaded files indicator */}
        {uploadedFiles.length > 0 && (
          <div className="px-4 py-2 border-b border-[var(--surface-border)] bg-[#00e5ff]/5 flex items-center gap-2 flex-wrap z-20">
            <FileText className="w-3.5 h-3.5 text-[#00e5ff] shrink-0" />
            <span className="text-xs text-foreground/60">
              {language === 'es' ? 'Documentos cargados:' : 'Loaded documents:'}
            </span>
            {uploadedFiles.map((name, i) => (
              <span key={i} className="text-xs bg-[#00e5ff]/10 text-[#00e5ff] px-2 py-0.5 rounded-full border border-[#00e5ff]/20 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                {name}
              </span>
            ))}
          </div>
        )}

        {/* Dynamic Main View: Text Chat vs Voice Orb */}
        <div className="flex-1 overflow-y-auto flex flex-col relative bg-[var(--background)] styled-scrollbar scroll-smooth">
          <AnimatePresence mode="wait">
            {voiceMode ? (
              <motion.div 
                key="voice"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4 }}
                className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-[#0f172a]/20 to-[#00e5ff]/5"
              >
                {/* 3D Orb Canvas */}
                <div className="w-full h-[350px] mb-6 relative rounded-2xl overflow-hidden bg-[#030712] border border-[#00e5ff]/20">
                  <Canvas camera={{ position: [0, 0, 5], fov: 45 }} gl={{ antialias: false }}>
                    <color attach="background" args={['#030712']} />
                    {/* Dimmer ambient light so the emissive glow pops */}
                    <ambientLight intensity={0.1} />
                    {/* Positioned lights to create Rim lighting on the orb */}
                    <directionalLight position={[10, 10, 5]} intensity={1} color="#ffffff" />
                    <directionalLight position={[-10, -10, -5]} intensity={2} color="#ec4899" />
                    <pointLight position={[0, 0, 2]} intensity={0.5} color="#00e5ff" />
                    
                    <InteractiveOrb volume={volume} isConnected={isConnected} isConnecting={isConnecting} />
                    
                    <Environment preset="night" />
                    
                    {/* Bloom setup - higher threshold so only the orb glows, not the background */}
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
                  <h4 className="text-xl font-bold mb-2 text-foreground">
                    {isConnecting ? t.chatAi.voiceConnectingTitle : t.chatAi.voiceTitle}
                  </h4>
                  <p className="text-sm text-foreground/60 mb-6 min-h-[40px]">
                    {error ? <span className="text-red-400">{error}</span> :
                     isConnected ? t.chatAi.voiceActive :
                     t.chatAi.voiceMicPermission}
                  </p>
                  
                  {/* Tool Action Logs */}
                  <div className="h-12 overflow-hidden mb-6 flex flex-col justify-end text-xs font-mono text-[#00e5ff]/80">
                    <AnimatePresence>
                      {messageLog.slice(-2).map((log, i) => (
                        <motion.div 
                          key={i}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                        >
                          {'>'} {log}
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>

                  <Button 
                    onClick={toggleRecording}
                    className="rounded-full w-16 h-16 bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white transition-all shadow-[0_0_20px_rgba(239,68,68,0.3)] mx-auto flex items-center justify-center"
                  >
                    <PhoneOff className="w-6 h-6" />
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="chat"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex-1 p-4 sm:p-6 flex flex-col gap-6 w-full"
              >
                {messages.map((msg) => (
                  <motion.div 
                    key={msg.id}
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 ${
                      msg.role === 'user' ? 'bg-[#00e5ff]/20 text-[#00e5ff]' : 'bg-[#0f172a] border border-[#00e5ff]/30 text-white'
                    }`}>
                      {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                    </div>
                    <div className={`max-w-[85%] sm:max-w-[80%] rounded-2xl px-5 py-3.5 text-sm sm:text-base leading-relaxed ${
                      msg.role === 'user' 
                        ? 'bg-[#00e5ff] text-[#0f172a] rounded-tr-sm shadow-[0_4px_15px_rgba(0,229,255,0.2)] font-medium' 
                        : 'bg-[#0f172a]/80 border border-[var(--surface-border-solid)] text-foreground/90 rounded-tl-sm shadow-sm prose prose-invert prose-p:leading-relaxed prose-pre:bg-[#030712] prose-pre:border prose-pre:border-[var(--surface-border-solid)] max-w-none'
                    }`}>
                      {msg.role === 'user' ? (
                        msg.content
                      ) : (
                        <>
                          {msg.webSearchUsed && (
                            <div className="flex items-center gap-1.5 text-xs text-[#8b5cf6] mb-2 pb-2 border-b border-[#8b5cf6]/20">
                              <Globe className="w-3.5 h-3.5" />
                              <span className="font-medium">
                                {language === 'es' ? 'Información complementada con búsqueda web' : 'Enhanced with web search'}
                              </span>
                            </div>
                          )}
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>
                        </>
                      )}
                    </div>
                  </motion.div>
                ))}
                
                {isTyping && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex gap-4"
                  >
                    <div className="w-8 h-8 rounded-full bg-[#0f172a] border border-[#00e5ff]/30 flex items-center justify-center shrink-0 mt-1 text-white">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="bg-[#0f172a]/80 border border-[var(--surface-border-solid)] rounded-2xl rounded-tl-sm px-5 py-4 flex items-center gap-1.5 self-start shadow-sm">
                      <span className="w-2 h-2 rounded-full bg-[#00e5ff]/60 animate-bounce" />
                      <span className="w-2 h-2 rounded-full bg-[#00e5ff]/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 rounded-full bg-[#00e5ff]/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </motion.div>
                )}
                <div ref={messagesEndRef} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Chat Input */}
        {!voiceMode && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 bg-[var(--background)] border-t border-[var(--surface-border)] relative z-20"
          >
            <form 
              onSubmit={handleSubmit}
              className="flex items-end gap-3 bg-[var(--surface-panel)] border border-[var(--surface-border-solid)] rounded-2xl p-2 focus-within:border-[#00e5ff]/50 focus-within:ring-1 focus-within:ring-[#00e5ff]/30 transition-all"
            >
              <button
                type="button"
                onClick={toggleRecording}
                className={`p-3 rounded-xl flex items-center justify-center shrink-0 transition-all bg-[var(--background)] text-foreground/50 hover:text-[#00e5ff] hover:bg-[#00e5ff]/10 hover:shadow-[0_0_15px_rgba(0,229,255,0.2)]`}
                title={t.chatAi.voiceButtonTitle}
              >
                <Mic className="w-5 h-5" />
              </button>

              {/* File upload button */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.csv,.json,.html,.xml"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="p-3 rounded-xl flex items-center justify-center shrink-0 transition-all bg-[var(--background)] text-foreground/50 hover:text-[#00e5ff] hover:bg-[#00e5ff]/10 hover:shadow-[0_0_15px_rgba(0,229,255,0.2)] disabled:opacity-50"
                title={language === 'es' ? 'Subir documento' : 'Upload document'}
              >
                {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
              </button>

              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t.chat.inputPlaceholder}
                className="flex-1 bg-transparent border-none focus:ring-0 text-foreground text-sm sm:text-base resize-none py-3 px-2 outline-none min-h-[44px] max-h-[120px]"
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
                className="p-3 rounded-xl bg-[#00e5ff] text-[#0f172a] shrink-0 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#60a5fa] hover:shadow-[0_0_15px_rgba(0,229,255,0.4)] transition-all"
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
            <p className="text-center text-xs text-foreground/40 mt-3 font-mono">
               {t.chat.disclaimer}
            </p>
          </motion.div>
        )}

      </GlassPanel>
    </section>
  );
}
