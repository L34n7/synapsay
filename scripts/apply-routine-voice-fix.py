from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Trecho não encontrado: {label}")
    return text.replace(old, new, 1)


token_path = Path("src/app/api/realtime/token/route.ts")
token = token_path.read_text()

token = replace_once(
    token,
    '''    [
      "A ferramenta manage_tasks é o cérebro unificado de agenda e rotinas.",
      "Use-a para tarefas, compromissos, lembretes e também para criar, editar, pausar, excluir, confirmar, recusar ou executar rotinas.",
      "Sempre envie em message a fala completa do usuário, preservando datas, horários, fontes e preferências.",
      "Quando a abertura mandar executar uma rotina automática, chame manage_tasks com a mensagem técnica exata fornecida, contendo EXECUTAR_ROTINA, routineId e referenceKey.",
      "Quando houver rotina aguardando confirmação, após a resposta do usuário chame manage_tasks com a resposta completa, mesmo que seja apenas 'sim', 'agora não' ou 'não quero mais'.",
      "Nunca diga que uma rotina foi criada ou alterada antes de a ferramenta confirmar success=true.",
      "Falar frequentemente sobre um assunto não cria rotina: apenas permite sugerir, e a criação exige autorização explícita.",
    ].join(" "),''',
    '''    [
      "manage_tasks gerencia somente tarefas, compromissos e lembretes da agenda.",
      "manage_routines gerencia exclusivamente rotinas recorrentes do assistente.",
      "Para qualquer pedido de criar, agendar, programar, automatizar, alterar, pausar, excluir, confirmar ou executar uma rotina, você DEVE chamar manage_routines antes de responder.",
      "Envie em message o pedido completo, reunindo detalhes relevantes das falas imediatamente anteriores: horário, recorrência, assunto, fontes e confirmação.",
      "Para executar rotina automática da abertura, chame manage_routines com o comando técnico exato contendo EXECUTAR_ROTINA, routineId e referenceKey.",
      "Para confirmar ou recusar rotina pendente, chame manage_routines mesmo que a resposta seja apenas sim, agora não ou não quero mais.",
      "É proibido afirmar que uma rotina foi criada, configurada, alterada ou excluída sem receber success=true. Em caso de erro, informe que não foi salva.",
      "Nunca diga que não existe ferramenta para rotinas: manage_routines está disponível.",
      "Um interesse recorrente pode gerar sugestão, mas nunca cria rotina sem autorização explícita.",
    ].join(" "),''',
    "instruções",
)

manage_tasks = '''            {
              type: "function",
              name: "manage_tasks",
              description:
                "Cérebro unificado que gerencia agenda, lembretes e rotinas do assistente, incluindo briefings e confirmações.",
              parameters: {
                type: "object",
                additionalProperties: false,
                required: ["message"],
                properties: {
                  message: {
                    type: "string",
                    description:
                      "Fala completa do usuário ou comando técnico de execução fornecido nas instruções de abertura.",
                  },
                },
              },
            },'''

manage_both = '''            {
              type: "function",
              name: "manage_tasks",
              description: "Gerencia exclusivamente tarefas, compromissos e lembretes da agenda.",
              parameters: {
                type: "object",
                additionalProperties: false,
                required: ["message"],
                properties: { message: { type: "string" } },
              },
            },
            {
              type: "function",
              name: "manage_routines",
              description: "Cria, atualiza, pausa, reativa, exclui, confirma e executa rotinas recorrentes. Use obrigatoriamente para qualquer pedido de rotina ou briefing recorrente.",
              parameters: {
                type: "object",
                additionalProperties: false,
                required: ["message"],
                properties: {
                  message: {
                    type: "string",
                    description: "Pedido completo, incluindo detalhes relevantes das falas anteriores.",
                  },
                },
              },
            },'''
token = replace_once(token, manage_tasks, manage_both, "ferramenta realtime")
token_path.write_text(token)


dashboard_path = Path("src/app/dashboard/page.tsx")
dashboard = dashboard_path.read_text()
anchor = '  const applyRealtimeVoice = useCallback((voice: string) => {'
handler = '''  const executeRoutineAssistant = useCallback(
    async (call: RealtimeFunctionCall) => {
      const channel = dataChannelRef.current;
      if (!channel || channel.readyState !== "open" || call.name !== "manage_routines" || !call.call_id) return false;

      let message = latestUserTranscriptRef.current;
      try {
        const args = JSON.parse(call.arguments || "{}") as { message?: string };
        message = args.message?.trim() || message;
      } catch {}

      setTranscript("Certo, estou salvando sua rotina.");
      let output: unknown;
      try {
        await Promise.allSettled([...pendingSavesRef.current]);
        const response = await fetch("/api/routines/brain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, source: "voice" }),
        });
        const result = await response.json();
        output = response.ok && result.handled
          ? { success: true, ...result, instruction: "Confirme somente o resumo retornado." }
          : { success: false, ...result, error: result.error ?? "A rotina não foi salva. Peça os dados ausentes sem afirmar que concluiu." };
      } catch {
        output = { success: false, error: "Não foi possível salvar a rotina agora." };
      }

      channel.send(JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) },
      }));
      return true;
    },
    [],
  );

'''
dashboard = replace_once(dashboard, anchor, handler + anchor, "handler")
dashboard = replace_once(
    dashboard,
    '              "manage_tasks",\n              "configure_assistant_personality",',
    '              "manage_tasks",\n              "manage_routines",\n              "configure_assistant_personality",',
    "lista de ferramentas",
)
dashboard = replace_once(
    dashboard,
    '''              call.name === "manage_tasks"
                ? executeTaskAssistant(call)
                : call.name === "configure_assistant_personality"''',
    '''              call.name === "manage_tasks"
                ? executeTaskAssistant(call)
                : call.name === "manage_routines"
                  ? executeRoutineAssistant(call)
                  : call.name === "configure_assistant_personality"''',
    "despachante",
)
dashboard = replace_once(
    dashboard,
    '    [executeHistorySearch, executePersonalityAssistant, executeTaskAssistant, saveMessage],',
    '    [executeHistorySearch, executePersonalityAssistant, executeRoutineAssistant, executeTaskAssistant, saveMessage],',
    "dependências",
)
dashboard_path.write_text(dashboard)
