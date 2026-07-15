"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

type Mode = "login" | "signup" | "recovery";

const content = {
  login: ["ACESSO AO SISTEMA", "Bem-vindo de volta", "Entre para acessar sua segunda mente.", "Entrar na Synapsay"],
  signup: ["NOVO OPERADOR", "Crie sua conta", "Comece a construir uma memória que trabalha com você.", "Criar minha conta"],
  recovery: ["RECUPERAR ACESSO", "Redefina sua senha", "Enviaremos um link seguro para o seu e-mail.", "Enviar link de recuperação"],
};

function MailIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11Z"/><path d="m4 7 8 6 8-6"/></svg>;
}

function LockIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14.5v2"/></svg>;
}

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ok: boolean; text: string} | null>(null);
  const [eyebrow, title, description, submitText] = content[mode];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const errorCode = new URLSearchParams(window.location.search).get("erro");
      if (errorCode === "sessao_expirada") {
        setMessage({ ok: false, text: "Sua sessão expirou. Entre novamente." });
      }
      if (errorCode === "confirmacao_invalida") {
        setMessage({ ok: false, text: "O link expirou ou já foi utilizado." });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function changeMode(next: Mode) {
    setMode(next);
    setPassword("");
    setMessage(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const supabase = createClient();
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        if (data.session) {
          router.replace("/dashboard");
          router.refresh();
          return;
        }
        setMessage({ ok: true, text: "Conta criada! Confira seu e-mail para confirmar o acesso." });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/redefinir-senha`,
        });
        if (error) throw error;
        setMessage({ ok: true, text: "Link enviado. Confira sua caixa de entrada." });
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Não foi possível concluir.";
      const translated: Record<string, string> = {
        "Invalid login credentials": "E-mail ou senha incorretos.",
        "User already registered": "Este e-mail já está cadastrado.",
        "Password should be at least 6 characters": "A senha deve ter pelo menos 6 caracteres.",
        "Email not confirmed": "Confirme seu e-mail antes de entrar.",
        "For security purposes, you can only request this after": "Aguarde alguns segundos antes de tentar novamente.",
      };
      setMessage({ ok: false, text: translated[raw] ?? raw });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.ambient}/><div className={styles.grid}/>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Synapsay"><i className={styles.logo}>•••</i><b>synap<span>say</span></b></Link>
        <div className={styles.status}><i/> SISTEMA ONLINE</div>
      </header>

      <section className={styles.shell}>
        <div className={styles.story}>
          <div className={styles.badge}>✦ SUA SEGUNDA MENTE</div>
          <h1>Pense menos no que lembrar.<br/><span>Foque no que criar.</span></h1>
          <p>Um assistente inteligente que organiza suas ideias, preserva seu contexto e transforma informação em ação.</p>
          <div className={styles.features}>
            <div><b>01</b><span><strong>Memória contínua</strong>Seu contexto sempre disponível</span></div>
            <div><b>02</b><span><strong>Inteligência pessoal</strong>Um assistente que evolui com você</span></div>
            <div><b>03</b><span><strong>Foco amplificado</strong>Menos ruído, melhores decisões</span></div>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTop}><span>{eyebrow}</span><small>SYN // 01</small></div>
          <h2>{title}</h2><p className={styles.subtitle}>{description}</p>
          <form onSubmit={submit}>
            <label htmlFor="email">E-MAIL</label>
            <div className={styles.input}><MailIcon/><input id="email" type="email" placeholder="voce@exemplo.com" value={email} onChange={e => setEmail(e.target.value)} required/></div>
            {mode !== "recovery" && <>
              <div className={styles.labelRow}><label htmlFor="password">SENHA</label>{mode === "login" && <button type="button" onClick={() => changeMode("recovery")}>Esqueceu a senha?</button>}</div>
              <div className={styles.input}><LockIcon/><input id="password" type={showPassword ? "text" : "password"} placeholder="••••••••" minLength={6} value={password} onChange={e => setPassword(e.target.value)} required/><button type="button" className={styles.eye} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "◉" : "○"}</button></div>
            </>}
            {message && <div className={message.ok ? styles.success : styles.error}>{message.text}</div>}
            <button className={styles.submit} disabled={loading}><span>{loading ? "Processando..." : submitText}</span><b>→</b></button>
          </form>
          <div className={styles.switch}>
            {mode === "login" && <>Ainda não tem uma conta? <button onClick={() => changeMode("signup")}>Criar conta</button></>}
            {mode === "signup" && <>Já possui uma conta? <button onClick={() => changeMode("login")}>Entrar</button></>}
            {mode === "recovery" && <button onClick={() => changeMode("login")}>← Voltar para o login</button>}
          </div>
        </div>
      </section>
      <footer className={styles.footer}><span>© 2026 SYNAPSAY</span><span>PRIVACIDADE · TERMOS</span></footer>
    </main>
  );
}
