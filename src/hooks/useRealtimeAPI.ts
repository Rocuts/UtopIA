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

          if (realtimeEvent.name === 'search_legal_docs') {
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
          }
        }
      };

      dc.onopen = () => {
        console.log("DataChannel open");
        // Register both tools: local RAG + web search
        dc.send(JSON.stringify({
          type: 'session.update',
          session: {
            tools: [
              {
                type: 'function',
                name: 'search_legal_docs',
                description: 'Search the LOCAL RAG legal database for U.S. law context. Covers: FLSA, EEOC/Title VII, OSHA, Immigration, and Personal Injury & Auto Accidents. ALWAYS use this tool FIRST before answering any legal question.',
                parameters: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', description: 'The topic or question to search for' }
                  },
                  required: ['query']
                }
              },
              {
                type: 'function',
                name: 'search_web',
                description: 'Search the INTERNET for current, up-to-date legal information from trusted government and legal sources (dol.gov, eeoc.gov, osha.gov, law.cornell.edu, congress.gov). Use AFTER search_legal_docs when the local database has no results or insufficient information, or when the user asks about specific statutes, recent legal changes, state-specific laws, or filing procedures not in the local database.',
                parameters: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', description: 'A precise legal search query. Include law names, statute numbers, or jurisdiction when possible.' }
                  },
                  required: ['query']
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
