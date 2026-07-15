"use client";

import { useEffect, useMemo, useState } from "react";
import {
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
import styles from "./personalidade.module.css";

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

export default function PersonalityPage() {
  const [form, setForm] = useState<AssistantPersonality>(DEFAULT_PERSONALITY);
  const [topicsText, setTopicsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch("/api/profile/personality", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok || !data.personality) throw new Error(data.error ?? "Não foi possível carregar suas preferências.");
        setForm(data.personality);
        setTopicsText(data.personality.prohibitedTopics.join("\n"));
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(true);
        setNotice(reason instanceof Error ? reason.message : "Falha ao carregar preferências.");
      } finally {
        setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
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

  async function save() {
    setSaving(true);
    setNotice("");
    setError(false);
    try {
      const prohibitedTopics = topicsText.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean);
      const response = await fetch("/api/profile/personality", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, prohibitedTopics }),
      });
      const data = await response.json();
      if (!response.ok || !data.personality) throw new Error(data.error ?? "Não foi possível salvar.");
      setForm(data.personality);
      setTopicsText(data.personality.prohibitedTopics.join("\n"));
      setNotice("Personalidade sincronizada. Ela será usada nas próximas respostas.");
    } catch (reason) {
      setError(true);
      setNotice(reason instanceof Error ? reason.message : "Falha ao salvar personalidade.");
    } finally {
      setSaving(false);
    }
  }

  function restore() {
    setForm(DEFAULT_PERSONALITY);
    setTopicsText("");
    setNotice("Configuração padrão carregada. Clique em salvar para confirmar.");
    setError(false);
  }

  return (
    <main className={styles.page}>
      <div className={styles.grid} />
      <div className={styles.glow} />

      <header className={styles.header}>
        <a href="/dashboard" className={styles.brand}><span>S</span>synap<b>say</b></a>
        <nav><a href="/dashboard">ASSISTENTE</a><a href="/memorias">MEMÓRIAS</a><a href="/agenda">AGENDA</a><a href="/historico">HISTÓRICO</a><i /> PERFIL SINCRONIZADO</nav>
      </header>

      <section className={styles.shell}>
        <div className={styles.intro}>
          <span>IDENTIDADE NEURAL // 04</span>
          <h1>Personalidade do <em>assistente</em></h1>
          <p>Defina como sua IA se apresenta, fala e responde. As preferências ficam vinculadas ao seu perfil.</p>
        </div>

        {notice && <div className={`${styles.notice} ${error ? styles.noticeError : ""}`}>{notice}</div>}

        <div className={styles.workspace} aria-busy={loading}>
          <div className={styles.forms}>
            <section className={styles.panel}>
              <div className={styles.panelTitle}><span>01</span><div><h2>Identidade e voz</h2><p>Como o assistente será chamado e ouvido.</p></div></div>
              <div className={styles.twoColumns}>
                <label>NOME DO ASSISTENTE<input value={form.assistantName} maxLength={40} disabled={loading} onChange={(event) => setField("assistantName", event.target.value)} /><small>{form.assistantName.length}/40 caracteres</small></label>
                <label>VOZ<select value={form.preferredVoice} disabled={loading} onChange={(event) => setField("preferredVoice", event.target.value as AssistantVoice)}>{ASSISTANT_VOICES.map((voice) => <option key={voice} value={voice}>{voices[voice]}</option>)}</select><small>Aplicada na próxima sessão de voz.</small></label>
              </div>
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
            <button type="button" onClick={restore} disabled={saving}>RESTAURAR PADRÃO</button>
            <button type="button" className={styles.save} onClick={() => void save()} disabled={saving || loading}>{saving ? "SINCRONIZANDO..." : "SALVAR PERSONALIDADE"}</button>
            <small className={styles.note}>Mudanças de voz entram em vigor na próxima sessão.</small>
          </aside>
        </div>
      </section>
    </main>
  );
}
