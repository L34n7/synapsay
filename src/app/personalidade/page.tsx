"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ASSISTANT_VOICE_OPTIONS,
  ASSISTANT_TONES,
  ASSISTANT_VOICES,
  COMMUNICATION_STYLES,
  DEFAULT_PERSONALITY,
  RESPONSE_DETAILS,
  type AssistantPersonality,
  type AssistantTone,
  type AssistantVoice,
  type CommunicationStyle,
  type ResponseDetail,
} from "@/lib/personality";
import { createClient } from "@/lib/supabase/client";
import styles from "./personalidade.module.css";

const PERSONALITY_ENDPOINT = "/api/profile/personality";
const VOICE_PREVIEW_ENDPOINT = "/api/profile/personality/voice/preview";
const VOICE_PREVIEW_COOLDOWN_MS = 3_000;

const voices: Record<AssistantVoice, string> = {
  marin: "Marin — clara e natural",
  cedar: "Cedar — calma e encorpada",
  coral: "Coral — expressiva e acolhedora",
  sage: "Sage — serena e segura",
  verse: "Verse — dinâmica e moderna",
  alloy: "Alloy — neutra e equilibrada",
  ash: "Ash — suave e direta",
  ballad: "Ballad — narrativa e fluida",
  echo: "Echo — firme e objetiva",
  shimmer: "Shimmer — leve e vibrante",
};

const communication: Record<CommunicationStyle, { label: string; detail: string }> = {
  balanced: { label: "Equilibrado", detail: "Essencial primeiro, contexto quando ajuda" },
  direct: { label: "Direto", detail: "Sem rodeios, foco na próxima ação" },
  explanatory: { label: "Explicativo", detail: "Passos, exemplos e lógica clara" },
  creative: { label: "Criativo", detail: "Analogias e alternativas originais" },
};

const details: Record<ResponseDetail, string> = {
  short: "Curtas",
  balanced: "Equilibradas",
  detailed: "Detalhadas",
};

const tones: Record<AssistantTone, string> = {
  friendly: "Amigável",
  professional: "Profissional",
  casual: "Descontraído",
};

function clientApiUrl(path: string) {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

function hasOnboardingParam() {
  if (typeof window === "undefined") return false;

  const query = window.location.search.startsWith("?")
    ? window.location.search.slice(1)
    : window.location.search;

  return query.split("&").some((entry) => {
    const [rawKey, rawValue = ""] = entry.split("=");

    try {
      return (
        decodeURIComponent(rawKey.replace(/\+/g, " ")) === "onboarding" &&
        decodeURIComponent(rawValue.replace(/\+/g, " ")) === "1"
      );
    } catch {
      return rawKey === "onboarding" && rawValue === "1";
    }
  });
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Resposta inesperada do servidor ao carregar a personalidade.");
  }
}

function apiError(data: Record<string, unknown> | null, fallback: string) {
  return typeof data?.error === "string" ? data.error : fallback;
}

function visibleErrorMessage(reason: unknown, fallback: string) {
  if (!(reason instanceof Error)) return fallback;
  if (!reason.message) return fallback;

  if (reason.message === "The string did not match the expected pattern.") {
    return fallback;
  }

  return reason.message;
}

export default function PersonalityPage() {
  const [form, setForm] = useState<AssistantPersonality>(DEFAULT_PERSONALITY);
  const [topicsText, setTopicsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [onboardingMode, setOnboardingMode] = useState(false);
  const [voicePreviewCacheKey, setVoicePreviewCacheKey] = useState("");
  const [previewingVoice, setPreviewingVoice] = useState<AssistantVoice | null>(null);
  const [voicePreviewCoolingDown, setVoicePreviewCoolingDown] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudiosRef = useRef(new Map<string, HTMLAudioElement>());
  const voicePreviewCooldownRef = useRef(false);
  const cooldownTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(clientApiUrl(PERSONALITY_ENDPOINT), {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await readJson(response);
        if (!response.ok || !data?.personality) {
          throw new Error(apiError(data, "Não foi possível carregar suas preferências."));
        }
        const personality = data.personality as AssistantPersonality;
        setForm(personality);
        setVoicePreviewCacheKey(
          typeof data.voicePreviewCacheKey === "string"
            ? data.voicePreviewCacheKey
            : "",
        );
        setTopicsText(personality.prohibitedTopics.join("\n"));
        setOnboardingMode(
          hasOnboardingParam() ||
            !personality.onboardingCompleted,
        );
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        console.error("Falha ao carregar personalidade:", reason);
        setError(true);
        setNotice(visibleErrorMessage(reason, "Não foi possível carregar suas preferências agora. Atualize a página e tente novamente."));
      } finally {
        setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const previewAudios = previewAudiosRef.current;

    return () => {
      audioRef.current?.pause();
      if (cooldownTimerRef.current !== null) {
        window.clearTimeout(cooldownTimerRef.current);
      }
      previewAudios.forEach((audio) => audio.pause());
      previewAudios.clear();
    };
  }, []);

  const preview = useMemo(() => {
    const opening = {
      friendly: "Claro! Vamos resolver isso juntos.",
      professional: "Certo. Esta é a abordagem recomendada.",
      casual: "Boa — vamos direto ao que funciona.",
    }[form.tone];
    const ending = {
      short: "Comece pela ação mais importante.",
      balanced: "Comece pela ação principal e valide o resultado antes de avançar.",
      detailed: "Comece pela ação principal, valide o resultado e avance com o contexto preservado.",
    }[form.responseDetail];
    return `${opening} ${ending}`;
  }, [form.responseDetail, form.tone]);

  function setField<K extends keyof AssistantPersonality>(field: K, value: AssistantPersonality[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setNotice("");
    setError(false);
  }

  function startVoicePreviewCooldown() {
    voicePreviewCooldownRef.current = true;
    setVoicePreviewCoolingDown(true);
    if (cooldownTimerRef.current !== null) {
      window.clearTimeout(cooldownTimerRef.current);
    }
    cooldownTimerRef.current = window.setTimeout(() => {
      voicePreviewCooldownRef.current = false;
      setVoicePreviewCoolingDown(false);
      cooldownTimerRef.current = null;
    }, VOICE_PREVIEW_COOLDOWN_MS);
  }

  async function previewVoice(voice: AssistantVoice) {
    setField("preferredVoice", voice);

    if (previewingVoice || voicePreviewCooldownRef.current) {
      return;
    }

    audioRef.current?.pause();
    setPreviewingVoice(voice);
    setNotice("");
    setError(false);
    startVoicePreviewCooldown();

    try {
      const previewCacheKey = `${voice}:${form.tone}:${form.communicationStyle}`;
      let audio = previewAudiosRef.current.get(previewCacheKey);

      if (!audio) {
        const previewUrl = `${clientApiUrl(VOICE_PREVIEW_ENDPOINT)}?voice=${encodeURIComponent(voice)}&tone=${encodeURIComponent(form.tone)}&communicationStyle=${encodeURIComponent(form.communicationStyle)}&cacheKey=${encodeURIComponent(voicePreviewCacheKey)}`;
        audio = new Audio(previewUrl);
        audio.preload = "auto";
        previewAudiosRef.current.set(previewCacheKey, audio);
      }

      audioRef.current = audio;
      audio.currentTime = 0;
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.addEventListener("ended", () => resolve(), { once: true });
        audio.addEventListener("error", () => resolve(), { once: true });
      });
    } catch (reason) {
      console.error("Falha ao reproduzir prévia de voz:", reason);
      setError(true);
      setNotice(
        visibleErrorMessage(
          reason,
          "Não foi possível reproduzir esta voz agora. Tente novamente.",
        ),
      );
    } finally {
      setPreviewingVoice(null);
    }
  }

  async function save() {
    setSaving(true);
    setNotice("");
    setError(false);
    try {
      const prohibitedTopics = topicsText.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean);
      const response = await fetch(clientApiUrl(PERSONALITY_ENDPOINT), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, prohibitedTopics }),
      });
      const data = await readJson(response);
      if (!response.ok || !data?.personality) {
        throw new Error(apiError(data, "Não foi possível salvar."));
      }
      const personality = data.personality as AssistantPersonality;
      setForm(personality);
      setVoicePreviewCacheKey(
        typeof data.voicePreviewCacheKey === "string"
          ? data.voicePreviewCacheKey
          : voicePreviewCacheKey,
      );
      setTopicsText(personality.prohibitedTopics.join("\n"));
      if (onboardingMode) {
        setNotice("Personalidade sincronizada. Vou abrir sua assistente agora.");
        window.setTimeout(() => {
          window.location.href = "/dashboard";
        }, 900);
      } else {
        setNotice("Personalidade sincronizada. Ela será usada nas próximas respostas.");
      }
    } catch (reason) {
      console.error("Falha ao salvar personalidade:", reason);
      setError(true);
      setNotice(visibleErrorMessage(reason, "Não foi possível salvar a personalidade agora. Atualize a página e tente novamente."));
    } finally {
      setSaving(false);
    }
  }

  function restore() {
    setForm((current) => ({
      ...DEFAULT_PERSONALITY,
      displayName: current.displayName,
      birthday: current.birthday,
    }));
    setTopicsText("");
    setNotice("Configuração padrão do assistente carregada. Seu nome e aniversário foram mantidos. Clique em salvar para confirmar.");
    setError(false);
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <main className={styles.page}>
      <div className={styles.grid} />
      <div className={styles.glow} />

      <header className={styles.header}>
        <a href="/dashboard" className={styles.brand}><span>S</span>synap<b>say</b></a>
        <nav>
          <a href="/dashboard">ASSISTENTE</a>
          <a href="/memorias">MEMÓRIAS</a>
          <a href="/agenda">AGENDA</a>
          <a href="/historico">HISTÓRICO</a>
          <i /> PERFIL SINCRONIZADO
          <button type="button" className={styles.logoutButton} onClick={() => void signOut()}>
            SAIR
          </button>
        </nav>
      </header>

      <section className={styles.shell}>
        <div className={styles.intro}>
          <span>IDENTIDADE NEURAL // 04</span>
          <h1>{onboardingMode ? "Configure seu" : "Personalidade do"} <em>assistente</em></h1>
          <p>
            {onboardingMode
              ? "Antes da primeira conversa, informe como a Synapsay deve te chamar, seu aniversário, voz e estilo."
              : "Defina como sua IA se apresenta, fala e responde. As preferências ficam vinculadas ao seu perfil."}
          </p>
        </div>

        {notice && <div className={`${styles.notice} ${error ? styles.noticeError : ""}`}>{notice}</div>}

        <div className={styles.workspace} aria-busy={loading}>
          <div className={styles.forms}>
            <section className={styles.panel}>
              <div className={styles.panelTitle}><span>01</span><div><h2>Perfil, identidade e voz</h2><p>Como a Synapsay te chama, lembra seu aniversário e fala com você.</p></div></div>
              <div className={styles.twoColumns}>
                <label>COMO DEVO TE CHAMAR?<input value={form.displayName} maxLength={40} disabled={loading} onChange={(event) => setField("displayName", event.target.value)} placeholder="Ex.: Leandro" /><small>{form.displayName.length}/40 caracteres</small></label>
                <label>DATA DE ANIVERSÁRIO<input value={form.birthday} type="date" disabled={loading} onChange={(event) => setField("birthday", event.target.value)} /><small>Usada para contexto pessoal e saudações futuras.</small></label>
              </div>
              <div className={styles.twoColumns}>
                <label>NOME DO ASSISTENTE<input value={form.assistantName} maxLength={40} disabled={loading} onChange={(event) => setField("assistantName", event.target.value)} /><small>{form.assistantName.length}/40 caracteres</small></label>
                <label>VOZ<select value={form.preferredVoice} disabled={loading} onChange={(event) => setField("preferredVoice", event.target.value as AssistantVoice)}>{ASSISTANT_VOICES.map((voice) => <option key={voice} value={voice}>{voices[voice]}</option>)}</select><small>Aplicada na próxima sessão de voz.</small></label>
              </div>
              <div className={styles.voiceChoices}>
                {ASSISTANT_VOICES.map((voice) => (
                  <button
                    type="button"
                    key={voice}
                    className={form.preferredVoice === voice ? styles.voiceSelected : ""}
                    onClick={() => void previewVoice(voice)}
                    disabled={loading}
                    aria-label={`Selecionar e ouvir uma prévia da voz ${ASSISTANT_VOICE_OPTIONS[voice].label}`}
                  >
                    <strong>{ASSISTANT_VOICE_OPTIONS[voice].label}</strong>
                    <span>{ASSISTANT_VOICE_OPTIONS[voice].description}</span>
                    <small>
                      {previewingVoice === voice
                        ? "REPRODUZINDO PRÉVIA..."
                        : form.preferredVoice === voice && voicePreviewCoolingDown
                          ? "AGUARDE PARA OUVIR NOVAMENTE"
                          : "CLIQUE PARA OUVIR"}
                    </small>
                  </button>
                ))}
              </div>
              <p className={styles.voicePreviewNote}>Prévia curta gerada por IA com o seu primeiro nome. Há um intervalo de 3 segundos entre reproduções e o áudio fica em cache neste navegador por até 30 dias.</p>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelTitle}><span>02</span><div><h2>Forma de comunicação</h2><p>Ajuste estrutura, tamanho e tom das respostas.</p></div></div>
              <div className={styles.cardChoices}>
                {COMMUNICATION_STYLES.map((style) => <button type="button" key={style} className={form.communicationStyle === style ? styles.selected : ""} onClick={() => setField("communicationStyle", style)}><strong>{communication[style].label}</strong><small>{communication[style].detail}</small></button>)}
              </div>
              <div className={styles.choiceGroups}>
                <fieldset><legend>TAMANHO DAS RESPOSTAS</legend><div>{RESPONSE_DETAILS.map((detail) => <button type="button" key={detail} className={form.responseDetail === detail ? styles.active : ""} onClick={() => setField("responseDetail", detail)}>{details[detail]}</button>)}</div></fieldset>
                <fieldset><legend>TOM</legend><div>{ASSISTANT_TONES.map((tone) => <button type="button" key={tone} className={form.tone === tone ? styles.active : ""} onClick={() => setField("tone", tone)}>{tones[tone]}</button>)}</div></fieldset>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelTitle}><span>03</span><div><h2>Limites e instruções</h2><p>Preferências permanentes para todas as conversas.</p></div></div>
              <div className={styles.textFields}>
                <label>LIMITES DO ASSISTENTE<textarea value={form.boundaries} maxLength={1500} rows={4} onChange={(event) => setField("boundaries", event.target.value)} placeholder="Ex.: não tomar decisões por mim." /><small>{form.boundaries.length}/1500</small></label>
                <label>ASSUNTOS BLOQUEADOS<textarea value={topicsText} rows={4} onChange={(event) => setTopicsText(event.target.value)} placeholder={"Um assunto por linha\nEx.: política partidária"} /><small>Até 12 assuntos.</small></label>
                <label className={styles.wide}>INSTRUÇÕES PERSONALIZADAS<textarea value={form.customInstructions} maxLength={2000} rows={5} onChange={(event) => setField("customInstructions", event.target.value)} placeholder="Ex.: termine planos com três próximas ações." /><small>{form.customInstructions.length}/2000</small></label>
              </div>
            </section>
          </div>

          <aside className={styles.preview}>
            <div className={styles.previewStatus}>PRÉVIA // PERFIL ATIVO <i /></div>
            <div className={styles.core}>{form.assistantName.slice(0, 1).toUpperCase() || "S"}</div>
            <h2>{form.assistantName || "Synapsay"}</h2>
            <span>{voices[form.preferredVoice].split(" — ")[0].toUpperCase()} VOICE</span>
            <div className={styles.wave}>{Array.from({ length: 25 }, (_, index) => <i key={index} />)}</div>
            <div className={styles.sample}><small>EXEMPLO DE RESPOSTA</small><p>{preview}</p></div>
            <dl><div><dt>ESTILO</dt><dd>{communication[form.communicationStyle].label}</dd></div><div><dt>DETALHE</dt><dd>{details[form.responseDetail]}</dd></div><div><dt>TOM</dt><dd>{tones[form.tone]}</dd></div><div><dt>BLOQUEIOS</dt><dd>{topicsText.split(/[\n,;]+/).filter((value) => value.trim()).length}</dd></div></dl>
            <dl><div><dt>USUÁRIO</dt><dd>{form.displayName || "Não informado"}</dd></div><div><dt>ANIVERSÁRIO</dt><dd>{form.birthday || "Não informado"}</dd></div></dl>
            <button type="button" onClick={restore} disabled={saving}>RESTAURAR PADRÃO</button>
            <button type="button" className={styles.save} onClick={() => void save()} disabled={saving || loading}>{saving ? "SINCRONIZANDO..." : onboardingMode ? "SALVAR E COMEÇAR" : "SALVAR PERSONALIDADE"}</button>
            <small className={styles.note}>Mudanças de voz entram em vigor na próxima sessão. Pela conversa, a Synapsay também pode demonstrar e trocar a voz de forma guiada.</small>
          </aside>
        </div>
      </section>
    </main>
  );
}
