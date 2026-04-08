import { useState, useRef, useEffect, useCallback } from 'react';

interface RealtimeAPIResult {
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
  volume: number;
  startSession: () => Promise<void>;
  stopSession: () => void;
  messageLog: string[];
}

const PLATFORM_INFO: Record<string, string> = {
  servicios: "UtopIA ofrece 4 servicios principales: 1) Defensa ante Requerimientos DIAN — análisis de requerimientos, estrategia de defensa, borradores de respuesta. 2) Devolución de Saldos a Favor — expediente técnico, validación de soportes, acompañamiento. 3) Preparación Empresarial (Due Diligence) — revisión de cumplimiento tributario, estados financieros NIIF, contingencias fiscales. 4) Inteligencia Financiera — análisis de rentabilidad, flujo de caja, proyecciones, impacto tributario.",
  defensa_dian: "El servicio de Defensa ante Requerimientos DIAN incluye: revisión documental automatizada, diagnóstico de riesgo fiscal (IVA, renta, retenciones, facturación electrónica), borrador de respuesta técnica con citas a doctrina y normativa, organización de soporte probatorio, y estrategia de defensa administrativa. Cubre requerimientos ordinarios (Art. 684), especiales (Art. 685), pliegos de cargos, y liquidaciones oficiales.",
  devolucion: "El servicio de Devolución de Saldos a Favor incluye: expediente técnico automatizado, validación de soportes y consistencia, análisis de viabilidad del trámite, acompañamiento documental ante la DIAN, y conexión tributario-tesorería-flujo de caja. Aplica para saldos a favor en IVA, renta, y retención en la fuente.",
  due_diligence: "El servicio de Preparación Empresarial incluye: due diligence contable y tributaria, modelación financiera y escenarios, detección de inconsistencias contables, narrativa financiera para inversionistas o bancos, e indicadores clave con estructura tributaria óptima.",
  inteligencia_financiera: "El servicio de Inteligencia Financiera incluye: análisis de rentabilidad por cliente, producto y línea de negocio, estructura de costos y márgenes, proyecciones de flujo de caja, presupuestos y escenarios what-if, e impacto tributario de decisiones de crecimiento.",
  como_funciona: "UtopIA funciona con inteligencia artificial especializada en contabilidad y tributaria colombiana. Puedes hacer consultas por texto o voz. El sistema busca en una base de conocimiento de normativa colombiana (Estatuto Tributario, decretos, resoluciones DIAN, NIIF) y también puede buscar en internet fuentes oficiales como dian.gov.co. Puedes subir documentos (PDF, Excel) para análisis. Selecciona un caso de uso específico para obtener respuestas más precisas.",
  precios: "Para información sobre precios y planes, te invitamos a contactar a nuestro equipo comercial. UtopIA ofrece planes adaptados al tamaño de tu firma contable y volumen de consultas."
};

export function useRealtimeAPI(): RealtimeAPIResult {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  const [messageLog, setMessageLog] = useState<string[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const stopSession = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setVolume(0);
  }, []);

  const calculateVolume = useCallback(() => {
    if (!analyserRef.current || !dataArrayRef.current) return;
    analyserRef.current.getByteFrequencyData(dataArrayRef.current as any);
    const sum = dataArrayRef.current.reduce((a, b) => a + b, 0);
    const avg = sum / dataArrayRef.current.length;
    // Normalize volume 0-1
    setVolume(Math.min(avg / 128, 1));
    animationFrameRef.current = requestAnimationFrame(calculateVolume);
  }, []);

  const startSession = useCallback(async () => {
    try {
      setIsConnecting(true);
      setError(null);

      // 1. Get an ephemeral token from our backend
      const tokenResponse = await fetch('/api/realtime');
      const tokenData = await tokenResponse.json();

      if (!tokenData.client_secret) {
        throw new Error('Failed to get ephemeral token');
      }
      const ephemeralKey = tokenData.client_secret;

      // 2. Setup RTCPeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Ensure audio plays when model speaks
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      pc.ontrack = (e) => {
        if (e.streams[0]) {
          audioEl.srcObject = e.streams[0];
          // Set up volume analyzer for the orb
          if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          }
          const ctx = audioContextRef.current;
          const source = ctx.createMediaStreamSource(e.streams[0]);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          analyserRef.current = analyser;
          dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
          calculateVolume();
        }
      };

      // 3. Add local microphone track
      let ms: MediaStream;
      try {
        ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        throw new Error('Microphone permission denied');
      }
      pc.addTrack(ms.getTracks()[0]);

      // 4. Setup Data Channel for Events/Tools
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.onmessage = async (e) => {
        const realtimeEvent = JSON.parse(e.data);

        // Handle tool calls
        if (realtimeEvent.type === 'response.function_call_arguments.done') {
          const args = JSON.parse(realtimeEvent.arguments);

          if (realtimeEvent.name === 'search_tax_docs') {
            setMessageLog(prev => [...prev, `📚 RAG: ${args.query}`]);

            try {
              const searchRes = await fetch('/api/rag', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: args.query })
              });
              const searchData = await searchRes.json();

              const eventInfo = {
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: realtimeEvent.call_id,
                  output: JSON.stringify(searchData)
                }
              };
              dc.send(JSON.stringify(eventInfo));
              dc.send(JSON.stringify({ type: 'response.create' }));
            } catch (err) {
              console.error("Error running RAG tool", err);
            }
          } else if (realtimeEvent.name === 'search_web') {
            setMessageLog(prev => [...prev, `🌐 Web: ${args.query}`]);

            try {
              const searchRes = await fetch('/api/web-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: args.query })
              });
              const searchData = await searchRes.json();

              const eventInfo = {
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: realtimeEvent.call_id,
                  output: JSON.stringify(searchData)
                }
              };
              dc.send(JSON.stringify(eventInfo));
              dc.send(JSON.stringify({ type: 'response.create' }));
            } catch (err) {
              console.error("Error running web search tool", err);
            }
          } else if (realtimeEvent.name === 'calculate_sanction') {
            setMessageLog(prev => [...prev, `🧮 Sanción: ${args.type}`]);

            try {
              const sanctionRes = await fetch('/api/tools/sanction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args)
              });
              const sanctionData = await sanctionRes.json();

              const eventInfo = {
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: realtimeEvent.call_id,
                  output: JSON.stringify(sanctionData)
                }
              };
              dc.send(JSON.stringify(eventInfo));
              dc.send(JSON.stringify({ type: 'response.create' }));
            } catch (err) {
              console.error("Error running sanction calculator tool", err);
            }
          } else if (realtimeEvent.name === 'get_platform_info') {
            setMessageLog(prev => [...prev, `ℹ️ Info: ${args.topic}`]);

            const info = PLATFORM_INFO[args.topic] || "Tema no encontrado. Los temas disponibles son: servicios, defensa_dian, devolucion, due_diligence, inteligencia_financiera, como_funciona, precios.";

            const eventInfo = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: realtimeEvent.call_id,
                output: JSON.stringify({ info })
              }
            };
            dc.send(JSON.stringify(eventInfo));
            dc.send(JSON.stringify({ type: 'response.create' }));
          }
        }
      };

      dc.onopen = () => {
        console.log("DataChannel open");
        // Register all 4 tools: RAG search, web search, sanction calculator, platform info
        dc.send(JSON.stringify({
          type: 'session.update',
          session: {
            tools: [
              {
                type: 'function',
                name: 'search_tax_docs',
                description: 'Busca en la base de conocimiento LOCAL de normativa tributaria colombiana. Cubre: Estatuto Tributario, decretos reglamentarios, resoluciones DIAN, doctrina oficial, NIIF/IFRS, CTCP, procedimientos tributarios, sanciones, devoluciones, facturación electrónica. SIEMPRE usa esta herramienta PRIMERO antes de responder cualquier pregunta tributaria o contable.',
                parameters: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', description: 'Consulta específica sobre normativa tributaria o contable colombiana' }
                  },
                  required: ['query']
                }
              },
              {
                type: 'function',
                name: 'search_web',
                description: 'Busca en fuentes colombianas confiables de internet (dian.gov.co, secretariasenado.gov.co, ctcp.gov.co, actualicese.com, gerencie.com). Usar DESPUÉS de search_tax_docs cuando no hay suficiente información local, o para datos actualizados como calendarios tributarios, UVT vigente, o resoluciones recientes.',
                parameters: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', description: 'Consulta precisa sobre temas tributarios/contables. Incluir artículos, decretos o resoluciones cuando sea posible.' }
                  },
                  required: ['query']
                }
              },
              {
                type: 'function',
                name: 'calculate_sanction',
                description: 'Calcula sanciones tributarias colombianas: extemporaneidad (Art. 641 E.T.), corrección (Art. 644), inexactitud (Art. 647), e intereses moratorios (Art. 634). Usar cuando el usuario pregunte cuánto tendría que pagar en sanciones, multas, o intereses.',
                parameters: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['extemporaneidad', 'correccion', 'inexactitud', 'intereses_moratorios'], description: 'Tipo de sanción a calcular' },
                    taxDue: { type: 'number', description: 'Impuesto a cargo en COP' },
                    grossIncome: { type: 'number', description: 'Ingresos brutos en COP' },
                    difference: { type: 'number', description: 'Mayor valor a pagar (para corrección/inexactitud)' },
                    delayMonths: { type: 'number', description: 'Meses de retraso' },
                    isVoluntary: { type: 'boolean', description: '¿Corrección voluntaria?' },
                    principal: { type: 'number', description: 'Capital para intereses moratorios' },
                    annualRate: { type: 'number', description: 'Tasa de interés anual (default 27.44%)' },
                    days: { type: 'number', description: 'Días de mora' }
                  },
                  required: ['type']
                }
              },
              {
                type: 'function',
                name: 'get_platform_info',
                description: 'Obtiene información sobre los servicios y capacidades de la plataforma UtopIA. Usar cuando el usuario pregunte qué puede hacer UtopIA, qué servicios ofrece, cómo funciona, o necesite orientación sobre qué caso de uso elegir.',
                parameters: {
                  type: 'object',
                  properties: {
                    topic: { type: 'string', enum: ['servicios', 'defensa_dian', 'devolucion', 'due_diligence', 'inteligencia_financiera', 'como_funciona', 'precios'], description: 'Tema sobre el que el usuario pregunta' }
                  },
                  required: ['topic']
                }
              }
            ],
            tool_choice: 'auto'
          }
        }));
      };

      // 5. Create Offer and connect to OpenAI WebRTC
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const baseUrl = 'https://api.openai.com/v1/realtime';
      const model = 'gpt-4o-realtime-preview-2024-12-17';
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      });

      if (!sdpResponse.ok) {
        throw new Error(`SDP Exchange Error: ${sdpResponse.status}`);
      }

      const answerSdp = await sdpResponse.text();
      const answer = { type: 'answer' as RTCSdpType, sdp: answerSdp };
      await pc.setRemoteDescription(answer);

      setIsConnected(true);
      setError(null);

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to start session');
      stopSession();
    } finally {
      setIsConnecting(false);
    }
  }, [stopSession, calculateVolume]);

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, [stopSession]);

  return {
    isConnecting,
    isConnected,
    error,
    volume,
    startSession,
    stopSession,
    messageLog
  };
}
