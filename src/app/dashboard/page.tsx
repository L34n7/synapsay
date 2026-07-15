"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import TextChat from "./TextChat";
import styles from "./dashboard.module.css";

type VoiceState =
  | "connecting"
  | "listening"
  | "hearing"
  | "speaking"
  | "muted"
  | "error";

type RealtimeFunctionCall = {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
};

type RealtimeEvent = {
  type?: string;
  item_id?: string;
  response_id?: string;
  transcript?: string;
  text?: string;
  delta?: string;
  item?: { content?: Array<{ transcript?: string; text?: string }> };
  response?: { id?: string; output?: RealtimeFunctionCall[] };
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MUTE_STORAGE_KEY = "synapsay:microphone-muted";

const stateCopy: Record<VoiceState, { label: string; detail: string }> = {
  connecting: { label: "SINCRONIZANDO", detail: "Preparando canal neural" },
  listening: { label: "OUVINDO", detail: "Pode falar comigo" },
  hearing: { label: "PROCESSANDO VOZ", detail: "Estou entendendo você" },
  speaking: { label: "SYNAPSAY RESPONDENDO", detail: "Conexão de voz ativa" },
  muted: { label: "MICROFONE MUTADO", detail: "Toque no botão para continuar" },
  error: { label: "CONEXÃO INTERROMPIDA", detail: "Verifique o acesso ao microfone" },
};

function MicIcon({ muted }: { muted: boolean }) {
  return muted ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m3 3 18 18M9 9v3a3 3 0 0 0 4.8 2.4M15 10V7a3 3 0 0 0-5.1-2.1M5 11v1a7 7 0 0 0 11 5.7M19 11v1c0 1-.2 1.9-.6 2.7M12 19v3M8 22h8" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8" />
    </svg>
  );
}

export default function Dashboard() {
  const [interactionMode, setInteractionMode] = useState<"voice" | "text">("voice");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("connecting");
  const [muted, setMuted] = useState(false);
  const [energy, setEnergy] = useState(0.08);
  const [transcript, setTranscript] = useState("Estou pronta. Como posso ajudar você hoje?");
  const [clock, setClock] = useState("");
  const [error, setError] = useState("");
  const [historyStatus, setHistoryStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [memoryStatus, setMemoryStatus] = useState<
    "idle" | "processing" | "error"
  >("idle");

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const mutedRef = useRef(false);
  const connectedRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const conversationPromiseRef = useRef<Promise<string> | null>(null);
  const savedEventsRef = useRef(new Set<string>());
  const pendingSavesRef = useRef(new Set<Promise<void>>());
  const assistantTranscriptRef = useRef("");
  const pendingAssistantTranscriptRef = useRef<{
    content: string;
    eventId: string;
  } | null>(null);
  const latestUserMessageIdRef = useRef<string | null>(null);
  const latestUserTranscriptRef = useRef("");
  const connectionAttemptRef = useRef(0);

  useEffect(() => {
    const savedMute = window.localStorage.getItem(MUTE_STORAGE_KEY) === "true";
    mutedRef.current = savedMute;
    setMuted(savedMute);
  }, []);

  const attachAnalyser = useCallback(
    (context: AudioContext, stream: MediaStream, target: "mic" | "output") => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      if (target === "mic") micAnalyserRef.current = analyser;
      else outputAnalyserRef.current = analyser;
    },
    [],
  );

  const startMeter = useCallback(() => {
    const sample = (analyser: AnalyserNode | null) => {
      if (!analyser) return 0;
      const values = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(values);
      return values.reduce((sum, value) => sum + value, 0) / values.length / 255;
    };

    const tick = () => {
      const mic = mutedRef.current ? 0 : sample(micAnalyserRef.current);
      const output = sample(outputAnalyserRef.current);
      const next = Math.min(1, Math.max(0.055, output * 2.4, mic * 1.8));
      setEnergy((current) => current * 0.76 + next * 0.24);

      if (!mutedRef.current && connectedRef.current) {
        if (output > 0.055) setVoiceState("speaking");
        else if (mic > 0.075) setVoiceState("hearing");
        else setVoiceState("listening");
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, []);

  const ensureConversation = useCallback(async (channel: "voice" | "text" = "voice") => {
    if (conversationIdRef.current) return conversationIdRef.current;
    if (conversationPromiseRef.current) return conversationPromiseRef.current;

    conversationPromiseRef.current = (async () => {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const data = await response.json();
      if (!response.ok || !data.conversation?.id) {
        throw new Error(data.error ?? "Não foi possível criar o histórico.");
      }
      conversationIdRef.current = data.conversation.id;
      setConversationId(data.conversation.id);
      return data.conversation.id as string;
    })();

    try {
      return await conversationPromiseRef.current;
    } catch (reason) {
      conversationPromiseRef.current = null;
      throw reason;
    }
  }, []);

  const saveMessage = useCallback(
    (
      role: "user" | "assistant",
      content: string,
      externalEventId: string,
    ) => {
      const normalized = content.trim();
      if (!normalized || savedEventsRef.current.has(externalEventId)) {
        return Promise.resolve();
      }

      savedEventsRef.current.add(externalEventId);
      setHistoryStatus("saving");

      const task = (async () => {
        try {
          const conversationId = await ensureConversation();
          const response = await fetch(
            `/api/conversations/${conversationId}/messages`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                role,
                content: normalized,
                inputType: "voice",
                externalEventId,
              }),
            },
          );
          const data = (await response.json().catch(() => null)) as {
            error?: string;
            message?: { id?: string } | null;
          } | null;
          if (!response.ok) {
            throw new Error(data?.error ?? "Falha ao salvar a mensagem.");
          }
          if (role === "user" && data?.message?.id) {
            latestUserMessageIdRef.current = data.message.id;
          }
          setHistoryStatus("saved");

          // A fala já foi salva. Agora o cérebro analisa a conversa sem
          // bloquear a resposta de voz e grava somente memórias úteis.
          if (role === "user") {
            void fetch(`/api/conversations/${conversationId}/memories/auto`, {
              method: "POST",
            })
              .then(async (memoryResponse) => {
                if (!memoryResponse.ok) {
                  const data = await memoryResponse.json().catch(() => null);
                  console.warn(
                    "Falha ao sincronizar memória automática:",
                    data?.error ?? memoryResponse.status,
                  );
                }
              })
              .catch((memoryError) => {
                console.warn(
                  "Falha ao iniciar memória automática:",
                  memoryError,
                );
              });
          }
        } catch (reason) {
          savedEventsRef.current.delete(externalEventId);
          setHistoryStatus("error");
          console.error("Falha ao salvar histórico de voz:", reason);
        }
      })();

      pendingSavesRef.current.add(task);
      void task.finally(() => pendingSavesRef.current.delete(task));
      return task;
    },
    [ensureConversation],
  );

  const executeHistorySearch = useCallback(
    async (call: RealtimeFunctionCall) => {
      const channel = dataChannelRef.current;
      if (
        !channel ||
        channel.readyState !== "open" ||
        call.name !== "search_conversation_history" ||
        !call.call_id
      ) {
        return;
      }

      let args: {
        query?: string;
        direction?: "around" | "before" | "after";
        scope?: "current" | "global" | "all";
        anchor_message_id?: string | null;
        window?: number;
        from?: string | null;
        to?: string | null;
      } = {};
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        args = {};
      }

      setTranscript("Hmm... só um minuto, deixa eu pensar.");

      let output: unknown;
      try {
        const currentConversationId = await ensureConversation();
        const latestRequest = latestUserTranscriptRef.current
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        const scope =
          /(?:agora ha pouco|nesta conversa|nessa conversa|alguns? minutos?|minutos? atras)/.test(
            latestRequest,
          )
            ? "current"
            : (args.scope ?? "all");
        const response = await fetch("/api/history/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: args.query ?? "",
            direction: args.direction ?? "around",
            scope,
            anchorMessageId: args.anchor_message_id ?? null,
            window: args.window ?? 4,
            currentConversationId,
            excludeMessageId: latestUserMessageIdRef.current,
            from: args.from ?? null,
            to: args.to ?? null,
          }),
        });
        output = await response.json();
        if (!response.ok) {
          output = {
            found: false,
            error:
              (output as { error?: string })?.error ??
              "Não foi possível consultar o histórico.",
          };
        }
      } catch {
        output = {
          found: false,
          error: "Não foi possível consultar o histórico agora.",
        };
      }

      channel.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(output),
          },
        }),
      );
      channel.send(JSON.stringify({ type: "response.create" }));
    },
    [ensureConversation],
  );

  const handleRealtimeEvent = useCallback(
    (data: RealtimeEvent) => {
      if (data.type === "response.created") {
        assistantTranscriptRef.current = "";
        pendingAssistantTranscriptRef.current = null;
        return;
      }

      if (data.type === "response.done") {
        const calls = (data.response?.output ?? []).filter(
          (item) =>
            item.type === "function_call" &&
            item.name === "search_conversation_history",
        );
        if (calls.length) {
          pendingAssistantTranscriptRef.current = null;
          assistantTranscriptRef.current = "";
          calls.forEach((call) => void executeHistorySearch(call));
          return;
        }

        const pending = pendingAssistantTranscriptRef.current;
        if (pending) {
          void saveMessage("assistant", pending.content, pending.eventId);
          pendingAssistantTranscriptRef.current = null;
        }
        assistantTranscriptRef.current = "";
        return;
      }

      if (
        data.type === "conversation.item.input_audio_transcription.completed" &&
        data.transcript
      ) {
        const finalTranscript = data.transcript.trim();
        if (finalTranscript) {
          latestUserTranscriptRef.current = finalTranscript;
          setTranscript(`Você: ${finalTranscript}`);
          void saveMessage(
            "user",
            finalTranscript,
            `user:${data.item_id ?? crypto.randomUUID()}`,
          );
        }
        return;
      }

      if (
        data.type === "response.output_audio_transcript.delta" &&
        data.delta
      ) {
        assistantTranscriptRef.current += data.delta;
        setTranscript(assistantTranscriptRef.current);
        return;
      }

      if (data.type === "response.output_audio_transcript.done") {
        const finalTranscript =
          data.transcript?.trim() || assistantTranscriptRef.current.trim();
        if (finalTranscript) {
          setTranscript(finalTranscript);
          pendingAssistantTranscriptRef.current = {
            content: finalTranscript,
            eventId: `assistant:${data.item_id ?? data.response_id ?? crypto.randomUUID()}`,
          };
        }
        return;
      }

      if (data.type === "response.output_text.done" && data.text?.trim()) {
        setTranscript(data.text.trim());
        pendingAssistantTranscriptRef.current = {
          content: data.text.trim(),
          eventId: `assistant:${data.item_id ?? data.response_id ?? crypto.randomUUID()}`,
        };
      }
    },
    [executeHistorySearch, saveMessage],
  );

  const connect = useCallback(async () => {
    const connectionAttempt = ++connectionAttemptRef.current;
    setError("");
    setVoiceState("connecting");

    try {
      const requestedConversation = new URLSearchParams(
        window.location.search,
      ).get("conversation") ?? conversationIdRef.current;
      let tokenUrl = "/api/realtime/token";

      if (requestedConversation) {
        if (!UUID_PATTERN.test(requestedConversation)) {
          throw new Error("Conversa inválida.");
        }
        const resumeResponse = await fetch(
          `/api/conversations/${requestedConversation}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "active" }),
          },
        );
        const resumeData = await resumeResponse.json();
        if (!resumeResponse.ok || !resumeData.conversation?.id) {
          throw new Error(
            resumeData.error ?? "Não foi possível retomar a conversa.",
          );
        }
        conversationIdRef.current = resumeData.conversation.id;
        setConversationId(resumeData.conversation.id);
        setTranscript(
          `Conversa “${resumeData.conversation.title ?? "sem título"}” retomada. Pode continuar.`,
        );
        tokenUrl = `/api/realtime/token?conversation=${encodeURIComponent(requestedConversation)}`;
      }

      const [stream, tokenResponse] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }),
        fetch(tokenUrl, { cache: "no-store" }),
      ]);
      if (connectionAttempt !== connectionAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !mutedRef.current;
      });

      const AudioContextClass = window.AudioContext;
      const context = new AudioContextClass();
      contextRef.current = context;
      await context.resume();
      attachAnalyser(context, stream, "mic");
      startMeter();

      const tokenData = await tokenResponse.json();
      if (connectionAttempt !== connectionAttemptRef.current) return;
      if (!tokenResponse.ok || !tokenData.value) {
        throw new Error(tokenData.error ?? "Não foi possível iniciar a IA por voz.");
      }

      const peer = new RTCPeerConnection();
      peerRef.current = peer;

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;

      peer.ontrack = (event) => {
        const remoteStream = event.streams[0];
        audio.srcObject = remoteStream;
        void audio.play().catch(() => undefined);
        attachAnalyser(context, remoteStream, "output");
      };

      stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));

      const channel = peer.createDataChannel("oai-events");
      dataChannelRef.current = channel;
      channel.onopen = () => {
        connectedRef.current = true;
        setVoiceState(mutedRef.current ? "muted" : "listening");
        window.setTimeout(() => {
          void fetch("/api/history/backfill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ limit: 50 }),
          }).catch(() => {
            // A busca literal continua disponível se o backfill falhar.
          });
        }, 2_500);
      };
      channel.onmessage = (event) => {
        try {
          handleRealtimeEvent(JSON.parse(event.data) as RealtimeEvent);
        } catch (reason) {
          console.error("Evento Realtime inválido:", reason);
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const sdpResponse = await fetch(
        "https://api.openai.com/v1/realtime/calls",
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${tokenData.value}`,
            "Content-Type": "application/sdp",
          },
        },
      );

      if (!sdpResponse.ok) {
        throw new Error("A conexão de voz não pôde ser estabelecida.");
      }

      if (connectionAttempt !== connectionAttemptRef.current) return;

      await peer.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text(),
      });
    } catch (reason) {
      if (connectionAttempt !== connectionAttemptRef.current) return;
      const message =
        reason instanceof Error
          ? reason.message
          : "Não foi possível acessar o microfone.";
      setError(message);
      setVoiceState("error");
    }
  }, [attachAnalyser, handleRealtimeEvent, startMeter]);

  useEffect(() => {
    const connectTimer = window.setTimeout(() => void connect(), 0);
    const updateClock = () =>
      setClock(
        new Intl.DateTimeFormat("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date()),
      );
    updateClock();
    const clockTimer = window.setInterval(updateClock, 1000);

    return () => {
      window.clearTimeout(connectTimer);
      window.clearInterval(clockTimer);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      dataChannelRef.current?.close();
      dataChannelRef.current = null;
      peerRef.current?.close();
      void contextRef.current?.close();
    };
  }, [connect]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    window.localStorage.setItem(MUTE_STORAGE_KEY, String(next));
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setVoiceState(next ? "muted" : "listening");
    setEnergy(next ? 0.04 : 0.08);
  }

  function stopVoice() {
    connectionAttemptRef.current += 1;
    connectedRef.current = false;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerRef.current?.close();
    void contextRef.current?.close();
  }

  function changeInteractionMode(next: "voice" | "text") {
    if (next === interactionMode) return;
    if (next === "text") {
      stopVoice();
      setInteractionMode("text");
      return;
    }
    setInteractionMode("voice");
    void connect();
  }

  async function finalizeConversation() {
    const conversationId = conversationIdRef.current;
    if (!conversationId) {
      setTranscript("Converse um pouco antes de gerar memórias.");
      return;
    }

    setMemoryStatus("processing");
    setError("");
    setTranscript("Analisando a conversa e separando apenas o que pode ser útil...");

    try {
      await Promise.allSettled([...pendingSavesRef.current]);
      const response = await fetch(
        `/api/conversations/${conversationId}/memories`,
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Não foi possível analisar a conversa.");
      }

      stopVoice();
      setMuted(true);
      setVoiceState("muted");
      setTranscript(
        data.insertedCount
          ? `${data.insertedCount} memória(s) sincronizada(s) automaticamente.`
          : "Conversa analisada. Nenhuma nova memória útil foi encontrada.",
      );
      window.setTimeout(() => {
        window.location.href = "/memorias";
      }, 900);
    } catch (reason) {
      setMemoryStatus("error");
      setTranscript(
        reason instanceof Error ? reason.message : "Falha ao gerar memórias.",
      );
    }
  }

  async function signOut() {
    stopVoice();
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const copy = stateCopy[voiceState];

  return (
    <main
      className={styles.page}
      style={{ "--energy": energy } as React.CSSProperties}
    >
      <div className={styles.grid} />
      <div className={styles.aurora} />

      <header className={styles.header}>
        <a href="/dashboard" className={styles.brand}>
          <span className={styles.brandMark}>S</span>
          <span>synap<b>say</b></span>
        </a>
        <div className={styles.systemLine}>
          <span><i /> NÚCLEO ONLINE</span>
          <span className={styles.clock}>{clock}</span>
          <button className={styles.avatar} aria-label="Sair da conta" title="Sair" onClick={() => void signOut()}>SAIR</button>
        </div>
      </header>

      <aside className={styles.rail} aria-label="Navegação principal">
        <button className={styles.active} aria-label="Assistente">
          <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 11a1 1 0 1 0 1 1" /></svg>
        </button>
        <a href="/memorias" aria-label="Memórias"><svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h6M8 16h4" /></svg></a>
        <a href="/historico" aria-label="Histórico"><svg viewBox="0 0 24 24"><path d="M4 17l5-5 3 3 7-8M15 7h4v4" /></svg></a>
        <span />
        <button aria-label="Configurações"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.5 1a8 8 0 0 0-1.7-1L14.3 3h-4.6l-.4 3a8 8 0 0 0-1.7 1L5 6 3 9.4 5.1 11a7 7 0 0 0 0 2L3 14.6 5 18l2.6-1a8 8 0 0 0 1.7 1l.4 3h4.6l.4-3a8 8 0 0 0 1.7-1l2.6 1 2-3.4-2.1-1.6a7 7 0 0 0 .1-1Z"/></svg></button>
      </aside>

      <section className={styles.stage}>
        <div className={styles.modeSwitch} aria-label="Modo de conversa">
          <button
            className={interactionMode === "voice" ? styles.modeActive : ""}
            onClick={() => changeInteractionMode("voice")}
          >
            ◉ VOZ
          </button>
          <button
            className={interactionMode === "text" ? styles.modeActive : ""}
            onClick={() => changeInteractionMode("text")}
          >
            ⌨ TEXTO
          </button>
        </div>

        {interactionMode === "voice" ? (
          <>
          <div className={styles.coordinates}><span>NEURAL CORE</span><span>LAT 23.5505° S</span></div>
          <div className={`${styles.hologram} ${styles[voiceState]}`}>
          <div className={styles.orbitOne}><i /><i /><i /></div>
          <div className={styles.orbitTwo}><i /><i /></div>
          <div className={styles.orbitThree} />
          <div className={styles.waveRing} />
          <div className={styles.coreShell}>
            <div className={styles.coreNoise} />
            <div className={styles.coreLight} />
          </div>
          <div className={styles.scanLine} />
          <div className={styles.floorGlow} />
          </div>

          <div className={styles.voiceStatus}>
          <span className={styles.statusDot} />
          <strong>{copy.label}</strong>
          <small>{copy.detail}</small>
          </div>

          <div className={styles.transcript}>
          <div className={styles.transcriptHeader}>
            <span>RESPOSTA ATUAL</span>
            <small
              className={
                historyStatus === "saving"
                  ? styles.historySaving
                  : historyStatus === "saved"
                    ? styles.historySaved
                    : historyStatus === "error"
                      ? styles.historyError
                      : undefined
              }
            >
              {historyStatus === "saving" && "SALVANDO HISTÓRICO"}
              {historyStatus === "saved" && "HISTÓRICO SINCRONIZADO"}
              {historyStatus === "error" && "FALHA AO SALVAR"}
            </small>
            {memoryStatus === "processing" && (
              <small className={styles.memoryProcessing}>EXTRAINDO MEMÓRIAS</small>
            )}
            {memoryStatus === "error" && (
              <small className={styles.historyError}>FALHA NA MEMÓRIA</small>
            )}
          </div>
          <p>{error || transcript}</p>
          </div>

          <div className={styles.controls}>
          {voiceState === "error" && (
            <button className={styles.retry} onClick={() => void connect()}>
              Tentar novamente
            </button>
          )}
          <button
            className={`${styles.micButton} ${muted ? styles.isMuted : ""}`}
            onClick={toggleMute}
            disabled={voiceState === "connecting" || voiceState === "error"}
            aria-label={muted ? "Ativar microfone" : "Mutar microfone"}
          >
            <span><MicIcon muted={muted} /></span>
            <b>{muted ? "ATIVAR MICROFONE" : "MUTAR MICROFONE"}</b>
            <i />
          </button>
          <button
            className={styles.finishButton}
            onClick={() => void finalizeConversation()}
            disabled={
              memoryStatus === "processing" ||
              historyStatus === "saving" ||
              voiceState === "connecting"
            }
          >
            {memoryStatus === "processing" ? "ANALISANDO..." : "FINALIZAR E MEMORIZAR"}
          </button>
          </div>
          </>
        ) : (
          <TextChat
            conversationId={conversationId}
            ensureConversation={ensureConversation}
            finalizing={memoryStatus === "processing"}
            onFinalize={() => void finalizeConversation()}
          />
        )}
      </section>

      <footer className={styles.footer}>
        <span>{interactionMode === "voice" ? "VOICE LINK // WEBRTC" : "TEXT STREAM // RESPONSES API"}</span>
        <span>CONEXÃO CRIPTOGRAFADA</span>
        <span>SYNAPSAY OS 0.1</span>
      </footer>
    </main>
  );
}
