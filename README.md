# Tarefas e Prazos · DARMAND

Gestão de tarefas, controle de equipe e prazos, no Railway. É um sistema **separado** do Portal do Gerente: tem pasta, repositório, serviço e banco próprios.

## O que tem

- **Início:** atrasadas, vencem hoje, próximos 7 dias, concluídas no mês (com % no prazo), minhas tarefas e as que passei para outros. O gestor também vê as atrasadas da equipe.
- **Tarefas:** lista com busca e filtros (pessoa, projeto, situação, prazo) ou quadro (A fazer → Em andamento → Aguardando → Concluída), arrastando os cartões.
- **Cronograma (Gantt):** cada tarefa é uma barra do início ao prazo, agrupada por projeto ou por pessoa, em escala de dias ou meses. Arraste a barra para mudar as datas, puxe as pontas para mudar início ou prazo, escolha o responsável na própria linha. Tarefa sem data: clique no dia da linha dela.
- **Prazos:** calendário do mês e lista agrupada (atrasadas, hoje, amanhã, próximos 7 dias, depois, sem prazo).
- **Projetos:** cadastro com objetivo, responsável, início, fim previsto, situação (planejamento, em andamento, pausado, concluído, cancelado) e cor. Cada projeto mostra % concluído, tarefas atrasadas, dias restantes e um indicador (No prazo, Em risco, Fora do prazo). A página do projeto tem o resumo, o cronograma por pessoa e as tarefas.
- **Equipe:** por pessoa, quantas abertas, atrasadas, vencendo em 7 dias, concluídas e % no prazo nos últimos 30 dias.
- **🎙 Narrar (IA):** fale (botão Falar, no Chrome e no Edge) ou escreva o que precisa ser feito: "para a inauguração da loja Norte, a Ana contrata 3 vendedores até sexta…". A IA (Claude, da Anthropic) monta as tarefas com responsável, projeto, início, prazo e prioridade, e o gestor também pode receber projetos novos. **Nada é criado sem revisão:** a tela mostra o que a IA entendeu e as dúvidas dela, você ajusta ou desmarca o que quiser e clica em Criar. As regras de permissão são as mesmas de sempre.
- **Histórico:** cada tarefa guarda comentários e registra sozinha quem mudou situação, prazo, responsável ou prioridade (ninguém "mexe no prazo" sem deixar rastro).

## Quem pode o quê

| | Gestor | Quem criou a tarefa | Responsável | Resto da equipe |
|---|---|---|---|---|
| Ver tarefas | todas | todas | todas | todas |
| Criar tarefa | sim | sim | sim | sim |
| Mudar título, prazo, responsável, prioridade | sim | sim | não | não |
| Mudar a situação (andamento) | sim | sim | sim | não |
| Comentar | sim | sim | sim | sim |
| Apagar tarefa | sim | sim | não | não |
| Equipe e criar projetos | sim | não | não | não |
| Editar um projeto | sim | o responsável pelo projeto também | | |

Gestores fixos ficam em `ADMIN_EMAILS`; outros podem ser promovidos na tela Equipe. Qualquer conta Google Workspace @darmand.com.br que entrar vira membro; o gestor pode desativar o acesso.

## Testar no computador

Precisa do Node.js 20 ou mais novo.

```
npm install
npm run dev
```

Abra http://localhost:3000/login e use "Entrar sem Google". O banco fica em memória e some ao fechar. `gestor@darmand.com.br` entra como gestor. Esse modo nunca liga dentro do Railway. Sem `ANTHROPIC_API_KEY`, o Narrar devolve uma proposta de exemplo fixa, só para testar a tela.

## Subir no Railway (uma vez)

1. **GitHub.** Crie um repositório **privado novo** (ex.: `tarefas-darmand`) e envie esta pasta. O `.gitignore` já deixa de fora o que não deve subir.
2. **Railway.** Crie um **projeto novo** (não use o do portal): New Project → Deploy from GitHub repo → selecione o repositório.
3. **Banco.** No mesmo projeto: New → Database → PostgreSQL. As tabelas são criadas sozinhas no primeiro início.
4. **Variáveis.** No serviço do app, em Variables, crie as do `.env.example`:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `GOOGLE_CLIENT_ID` (passo 6)
   - `ALLOWED_DOMAIN` = `darmand.com.br`
   - `ADMIN_EMAILS` = e-mails dos gestores, separados por vírgula
   - `SESSION_SECRET` = texto aleatório longo, **diferente** do portal
   - `ANTHROPIC_API_KEY` = chave da API da Anthropic, para o Narrar. Crie em [platform.claude.com](https://platform.claude.com) → Settings → API Keys (precisa de créditos na conta). Sem ela, o resto do sistema funciona e o Narrar avisa que a IA não está configurada. Cada narração custa poucos centavos de dólar; há um limite de 30 narrações por pessoa por hora.
5. **Endereço.** Settings → Networking → Generate Domain (ou um domínio próprio, ex.: `tarefas.darmand.com.br`).
6. **Login Google.** No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), dá para usar o mesmo *ID do cliente OAuth* do portal: abra-o e acrescente o endereço novo em "Origens JavaScript autorizadas". Ou crie um ID novo (tipo Aplicativo da Web) só para este sistema. Coloque o Client ID em `GOOGLE_CLIENT_ID`.
7. Abra o endereço, entre com sua conta e cadastre a equipe em **Equipe → Adicionar pessoa**.

Para conferir qual versão está no ar: `GET /healthz`.

## Arquivos

| Arquivo | O que é |
|---|---|
| `server.js` | servidor (Node + Express), login Google, API e banco |
| `ia.js` | Narrar: instruções e formato da resposta da IA (modelo `claude-opus-5-5`) |
| `public/app.html` | a tela do sistema |
| `public/login.html` | tela de entrada |
| `public/marca/` | logo e ícones DARMAND |
| `ferramentas/dev.js` | modo de teste no computador |
