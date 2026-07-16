# Synapsay

Assistente pessoal por voz com autenticação, histórico e memória controlada pelo usuário.

## Configuração

Variáveis necessárias em `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
OPENAI_API_KEY=
# Opcional. Modelos padrão da Synapsay.
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENAI_TEXT_MODEL=gpt-5.6-luna
OPENAI_MEMORY_MODEL=gpt-5.6-luna
OPENAI_MEMORY_CONFLICT_MODEL=gpt-5.6-luna

# Backend privado. Copie em Supabase > Project Settings > API Keys.
# Nunca use NEXT_PUBLIC_ neste nome.
SUPABASE_SECRET_KEY=
# Também é aceito o nome legado: SUPABASE_SERVICE_ROLE_KEY

# Google Calendar OAuth (todos são exclusivos do servidor)
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/api/integracoes/google-calendar/callback
# Em produção, use a callback https://synapsay.vercel.app/api/integracoes/google-calendar/callback
# Gere uma chave longa e aleatória, por exemplo: openssl rand -base64 48
GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY=
# Opcional: derivada automaticamente da origem da callback em produção.
GOOGLE_CALENDAR_WEBHOOK_URL=https://synapsay.vercel.app/api/integracoes/google-calendar/webhook

# Protege a rotina automática diária da Vercel (mínimo de 16 caracteres)
CRON_SECRET=
```

No Supabase, aplique em ordem os arquivos da pasta `supabase/migrations`. A etapa de memória depende de `202607130003_memory_engine.sql`; o histórico avançado e a retomada de conversas dependem de `202607130004_conversation_history.sql`.

Após cada fala do usuário, o cérebro de memória analisa a conversa em segundo plano e salva automaticamente apenas fatos úteis. Memórias ativas entram no contexto das próximas conversas; o botão **Esquecer** remove a memória permanentemente.

O histórico está disponível em `/historico`. Conversas finalizadas recebem um título automático, podem ser pesquisadas por título ou conteúdo, e podem ser retomadas com as últimas mensagens como contexto. Conversas sem atividade por 30 minutos são encerradas quando o histórico é sincronizado.

A Synapsay também possui busca global de histórico. Pedidos como **“lembra disso?”**, **“eu falei sobre isso?”** e **“traga mais mensagens antes/depois”** são interpretados pela IA. A busca retorna trechos apenas das conversas do usuário autenticado, com âncoras para expansão progressiva. Quando nada é encontrado, a assistente informa isso sem inventar lembranças.

## Google Agenda

Antes de conectar uma conta, aplique a migration `20260716064051_google_calendar_integration.sql`. Depois, abra `/agenda` e use **Conectar Google Agenda**.

A integração permite escolher qualquer agenda em que a conta tenha permissão de escrita e oferece três fluxos: bidirecional, somente Google → Synapsay ou somente Synapsay → Google. Depois da primeira carga, a sincronização usa o `syncToken` do Google para buscar somente alterações. O Google avisa o webhook quando a agenda muda e, antes de responder, a assistente aplica as mudanças pendentes. Uma consulta incremental curta também é feita no início das mensagens para cobrir notificações eventualmente não entregues. Tarefas locais são enviadas automaticamente ao Google.

O cron padrão roda diariamente às 09:00 UTC (06:00 em Brasília), frequência compatível com o plano Hobby da Vercel. Além da reconciliação de segurança, ele renova os canais de notificação que estiverem próximos do vencimento. Em um plano Pro, a expressão pode ser aumentada para uma execução horária (`0 * * * *`).

Os tokens OAuth são criptografados com AES-256-GCM antes de serem armazenados. As tabelas da integração não concedem acesso aos papéis `anon` e `authenticated`; somente o backend com `service_role` pode lê-las.

No dashboard, o seletor **Voz / Texto** mantém os dois canais na mesma conversa. O chat por texto usa streaming, permite interromper e copiar respostas, e reutiliza o mesmo identificador ao tentar novamente para evitar mensagens duplicadas. Essa etapa depende de `202607130005_text_chat.sql`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
"# synapsay"  
