# Synapsay — instalação da Etapa 4

Este pacote é incremental e deve ser aplicado sobre o projeto com as Etapas 1, 2 e 3 já instaladas.

## Aplicar

1. Extraia o ZIP dentro da pasta raiz do projeto Synapsay. Confirme a mesclagem das pastas `src` e `supabase`.
2. Abra o terminal na raiz do projeto e execute:

```bash
git apply etapa4-alteracoes.patch
npm run lint
npm run build
```

3. No SQL Editor do Supabase, execute o arquivo:

```text
supabase/migrations/202607130006_assistant_personality.sql
```

4. Inicie o projeto e abra o ícone de engrenagem do dashboard. A página estará em `/personalidade`.

## Se o Git informar que o patch já foi aplicado

Execute primeiro:

```bash
git apply --check etapa4-alteracoes.patch
```

Se aparecer que o patch não se aplica porque as linhas já existem, não execute novamente. Rode apenas `npm run lint` e `npm run build`.
