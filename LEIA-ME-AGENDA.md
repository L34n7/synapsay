# Synapsay — tarefas, lembretes e agenda

## Ativação do banco

Antes de testar esta versão, abra o **SQL Editor** do projeto correto no Supabase e execute, por inteiro:

`supabase/migrations/20260715193000_tasks_reminders_agenda.sql`

Para ativar também a integração com o Google Agenda, execute depois:

`supabase/migrations/20260716064051_google_calendar_integration.sql`

A migration cria `tasks` e `reminders`, índices, validações, permissões e políticas RLS que isolam os dados de cada usuário.

## O que testar

1. Abra `/agenda`, crie uma tarefa manual e configure um lembrete alguns minutos à frente.
2. Clique em **Ativar notificações** e permita notificações no navegador.
3. Fale com a Synapsay: “Hoje às 20h preciso falar com meu primo. Me lembre às 19h50.”
4. Pergunte: “O que tenho para hoje?”
5. Diga: “Concluí a tarefa de falar com meu primo.”
6. Reabra o assistente de voz com uma tarefa de hoje pendente; a Synapsay deve avisá-la no início.
7. Em `/agenda`, conecte uma conta Google, selecione uma agenda editável e clique em **Sincronizar agora**.
8. Crie e edite um compromisso nos dois sistemas e confirme a atualização bidirecional.

## Limite desta primeira versão

A notificação do navegador funciona com a Synapsay aberta, inclusive em outra aba ou em segundo plano. Para entregar notificações com o navegador totalmente fechado será necessário adicionar Web Push com inscrição do dispositivo e um disparador agendado no servidor. Essa camada pode ser incluída junto das futuras integrações de Google Agenda e WhatsApp.
