"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./redefinir-senha.module.css";

export default function RedefinirSenha() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    if (password !== confirmation) {
      setMessage({ ok: false, text: "As senhas não são iguais." });
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setMessage({ ok: false, text: error.message });
      return;
    }

    setMessage({ ok: true, text: "Senha alterada com sucesso." });
    window.setTimeout(() => {
      router.replace("/dashboard");
      router.refresh();
    }, 900);
  }

  return (
    <main className={styles.page}>
      <div className={styles.grid} />
      <Link href="/" className={styles.brand}>synap<b>say</b></Link>
      <section className={styles.card}>
        <span className={styles.eyebrow}>NOVA CREDENCIAL</span>
        <h1>Crie uma nova senha</h1>
        <p>Use pelo menos seis caracteres e não reutilize uma senha antiga.</p>
        <form onSubmit={submit}>
          <label htmlFor="password">NOVA SENHA</label>
          <input id="password" type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required />
          <label htmlFor="confirmation">CONFIRMAR SENHA</label>
          <input id="confirmation" type="password" minLength={6} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
          {message && <div className={message.ok ? styles.success : styles.error}>{message.text}</div>}
          <button disabled={loading}>{loading ? "Salvando..." : "Atualizar senha"}<b>→</b></button>
        </form>
      </section>
    </main>
  );
}
