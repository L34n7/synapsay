const PREVIEW_ENDPOINT = "/api/profile/personality/voice/preview";

type PreviewToolOutput = {
  status?: string;
  previewVoice?: string;
  previewPlayed?: boolean;
  message?: string;
  error?: string;
  [key: string]: unknown;
};

type PendingPreview = {
  channel: RTCDataChannel;
  promise: Promise<void>;
};

type RTCDataChannelPayload =
  | string
  | Blob
  | ArrayBuffer
  | ArrayBufferView;

declare global {
  interface Window {
    __synapsayVoicePreviewPatched?: boolean;
  }
}

let previewContext: AudioContext | null = null;
let activeSource: AudioBufferSourceNode | null = null;
let pendingPreview: PendingPreview | null = null;

function isDashboard() {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/dashboard");
}

async function playPreview(voice: string) {
  const response = await fetch(
    `${PREVIEW_ENDPOINT}?voice=${encodeURIComponent(voice)}`,
    { cache: "force-cache" },
  );

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? "Não foi possível reproduzir esta voz agora.");
  }

  const AudioContextClass = window.AudioContext;
  previewContext ??= new AudioContextClass();
  if (previewContext.state === "suspended") {
    await previewContext.resume();
  }

  activeSource?.stop();
  activeSource = null;

  const buffer = await previewContext.decodeAudioData(await response.arrayBuffer());
  const source = previewContext.createBufferSource();
  source.buffer = buffer;
  source.connect(previewContext.destination);
  activeSource = source;

  await new Promise<void>((resolve, reject) => {
    source.addEventListener("ended", () => resolve(), { once: true });
    try {
      source.start(0);
    } catch (reason) {
      reject(reason);
    }
  });

  if (activeSource === source) activeSource = null;
  source.disconnect();
}

function parsePreviewOutput(data: string) {
  try {
    const event = JSON.parse(data) as {
      type?: string;
      item?: {
        type?: string;
        output?: string;
      };
    };
    if (
      event.type !== "conversation.item.create" ||
      event.item?.type !== "function_call_output" ||
      typeof event.item.output !== "string"
    ) {
      return null;
    }

    const output = JSON.parse(event.item.output) as PreviewToolOutput;
    if (output.status !== "preview" || typeof output.previewVoice !== "string") {
      return null;
    }

    return { event, output };
  } catch {
    return null;
  }
}

export function installRealtimeVoicePreviewPlayback() {
  if (
    typeof window === "undefined" ||
    typeof RTCDataChannel === "undefined" ||
    window.__synapsayVoicePreviewPatched
  ) {
    return;
  }

  window.__synapsayVoicePreviewPatched = true;
  const originalSend = RTCDataChannel.prototype.send as unknown as (
    this: RTCDataChannel,
    data: RTCDataChannelPayload,
  ) => void;

  RTCDataChannel.prototype.send = function patchedSend(data: RTCDataChannelPayload) {
    if (!isDashboard() || typeof data !== "string") {
      originalSend.call(this, data);
      return;
    }

    const parsed = parsePreviewOutput(data);
    if (parsed) {
      const channel = this;
      const promise = playPreview(parsed.output.previewVoice as string)
        .then(() => {
          parsed.output.previewPlayed = true;
          parsed.output.message =
            "A prévia foi reproduzida de verdade. Pergunte apenas se o usuário quer salvar esta voz, ouvir outra ou cancelar.";
          parsed.event.item!.output = JSON.stringify(parsed.output);
        })
        .catch((reason) => {
          parsed.output.status = "preview_error";
          parsed.output.previewPlayed = false;
          parsed.output.error =
            reason instanceof Error
              ? reason.message
              : "Não foi possível reproduzir esta voz agora.";
          parsed.output.message =
            "A prévia não foi reproduzida. Informe a falha sem afirmar que o usuário ouviu a voz e ofereça tentar novamente.";
          parsed.event.item!.output = JSON.stringify(parsed.output);
        })
        .then(() => {
          originalSend.call(channel, JSON.stringify(parsed.event));
        });

      pendingPreview = { channel, promise };
      return;
    }

    try {
      const event = JSON.parse(data) as { type?: string };
      if (
        event.type === "response.create" &&
        pendingPreview?.channel === this
      ) {
        const current = pendingPreview;
        pendingPreview = null;
        void current.promise.finally(() => {
          if (this.readyState === "open") originalSend.call(this, data);
        });
        return;
      }
    } catch {
      // Eventos não JSON seguem normalmente.
    }

    originalSend.call(this, data);
  };
}

installRealtimeVoicePreviewPlayback();