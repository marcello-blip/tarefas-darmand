# Tarefas e Prazos · DARMAND

Gestão de tarefas, controle de equipe e prazos, no Railway. É um sistema **separado** do Portal do Gerente: tem pasta, repositório, serviço e banco próprios.

## O que tem

- **Início (espaço pessoal):** "Bem-vindo(a)" com o nome da pessoa e um resumo do dia (o que vence hoje, atrasadas, lembretes, aprovações esperando). Ao lado, o **📌 Meu mural**: lembretes particulares (🔒 só a pessoa vê), com ou sem data, que podem se repetir, como um checklist. Embaixo, "Esperando sua aprovação", "Minhas tarefas" (em lista ou quadro), os indicadores, as que passei para outros e, para o gestor, as atrasadas da equipe.
- **Tarefas:** lista com busca e filtros (pessoa, projeto, situação, prazo) ou quadro Kanban de 4 colunas: **A fazer → Fazendo → Aguardando aprovação → Concluído**, arrastando os cartões. Cada pessoa escolhe lista ou quadro, e a escolha fica salva na conta dela (vale em qualquer computador).
- **Aprovação:** quem é responsável por uma tarefa pedida por outra pessoa leva até **Aguardando aprovação** (se arrastar para Concluído, ela para em Aguardando). Quem pediu, ou um gestor, clica em **✅ Aprovar** ou **↩ Devolver**. Tudo fica no histórico.
- **Recorrência:** tarefas e lembretes podem repetir (todo dia, dias úteis, toda semana, a cada 15 dias, todo mês, todo ano). Ao concluir uma tarefa recorrente, a próxima é criada sozinha, com o mesmo responsável, projeto e duração; um lembrete recorrente marcado como feito volta na próxima data.
- **Cronograma (Gantt):** cada tarefa é uma barra do início ao prazo, agrupada por projeto ou por pessoa, em escala de dias ou meses. Arraste a barra para mudar as datas, puxe as pontas para mudar início ou prazo, escolha o responsável na própria linha. Tarefa sem data: clique no dia da linha dela.
- **Prazos:** calendário do mês e lista agrupada (atrasadas, hoje, amanhã, próximos 7 dias, depois, sem prazo).
- **Projetos:** cadastro com objetivo, responsável, início, fim previsto, situação (planejamento, em andamento, pausado, concluído, cancelado) e cor. Cada projeto mostra % concluído, tarefas atrasadas, dias restantes e um indicador (No prazo, Em risco, Fora do prazo). A página do projeto tem o resumo, o cronograma por pessoa e as tarefas.
- **Equipe:** por pessoa, quantas abertas, atrasadas, vencendo em 7 dias, concluídas e % no prazo nos últimos 30 dias.
- **🎙 Narrar (IA):** fale (botão Falar, no Chrome e no Edge) ou escreva o que precisa ser feito: "para a inauguração da loja Norte, a Ana contrata 3 vendedores até sexta…". A IA (Claude, da Anthropic) monta as tarefas com responsável, projeto, início, prazo e prioridade, e o gestor também pode receber projetos novos. **Nada é criado sem revisão:** a tela mostra o que a IA entendeu e as dúvidas dela, você ajusta ou desmarca o que quiser e clica em Criar. As regras de permissão são as mesmas de sempre.
- **📅 Google Agenda:** cada pessoa conecta a própria conta uma vez (aviso no Início ou menu da conta, no canto superior direito). As tarefas sob responsabilidade dela com data viram eventos de dia inteiro na **agenda principal**, do início ao prazo, com projeto, situação e link para o sistema. Mudou no sistema (datas no Gantt, responsável, concluída ✅, apagada), muda na agenda. A sincronização é só do sistema para a agenda: o que for mudado direto no Google Agenda não volta. Na tela Equipe, 📅 indica quem já conectou.
- **Histórico:** cada tarefa guarda comentários e registra sozinha quem mudou situação, prazo, responsável ou prioridade (ninguém "mexe no prazo" sem deixar rastro).

## Privacidade: quem vê o quê

Ninguém vê por cargo, nem gestor nem diretoria.

- **Projeto:** só os **membros** veem o projeto e as tarefas dele. Qualquer pessoa pode criar um projeto; quem cria (e o responsável pelo projeto) é **dono** e convida as pessoas na página do projeto (👥 Membros). Donos editam o projeto, convidam, removem e passam a posse; cada membro pode sair. Ao remover alguém, as tarefas abertas dele(a) no projeto ficam sem responsável.
- **Tarefa sem projeto:** só **quem criou** e **o responsável** veem.
- **Lembretes do mural:** só o dono.
- **Responsável** de uma tarefa de projeto precisa ser membro do projeto: primeiro convide, depois designe.
- O **Narrar** só enxerga os projetos de quem está narrando. Num projeto novo criado por ele, quem for designado para as tarefas entra como membro.
- Projetos que já existiam antes da privacidade receberam como membros o responsável (dono) e todas as pessoas que já tinham tarefas neles.

## Quem pode o quê (entre quem vê a tarefa)

| | Quem criou a tarefa, donos do projeto e gestor | Responsável | Demais membros |
|---|---|---|---|
| Criar tarefa (no projeto, só membros) | sim | sim | sim |
| Mudar título, prazo, responsável, prioridade | sim | não | não |
| Mudar a situação (A fazer, Fazendo, Aguardando aprovação) | sim | sim | não |
| Aprovar (marcar como Concluído) ou devolver | sim | não (vai para Aguardando aprovação) | não |
| Comentar | sim | sim | sim |
| Apagar tarefa | sim | não | não |

O **gestor** cuida do cadastro da equipe (adicionar, editar, desativar pessoas) e só enxerga os projetos dos quais faz parte. Gestores fixos ficam em `ADMIN_EMAILS`; outros podem ser promovidos na tela Equipe. Qualquer conta Google Workspace @darmand.com.br que entrar vira membro; o gestor pode desativar o acesso.

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

## Ligar o Google Agenda (uma vez)

No [Google Cloud Console](https://console.cloud.google.com), no mesmo projeto do ID de login:

1. **APIs e serviços → Biblioteca:** procure **Google Calendar API** e clique em **Ativar**.
2. **Tela de consentimento OAuth:** tipo de usuário **Interno**, para só contas @darmand.com.br poderem autorizar e não ser preciso verificação do Google. Em **Escopos**, adicione `.../auth/calendar.events`.
3. **Credenciais → o ID do cliente OAuth do login:**
   - Em **URIs de redirecionamento autorizados**, adicione `https://<endereço-do-sistema>/api/google/retorno`. Se houver domínio próprio, adicione também com ele.
   - Copie a **chave secreta do cliente** (`GOCSPX-...`).
4. **Railway → Variables:** crie `GOOGLE_CLIENT_SECRET` com a chave secreta. Se usar domínio próprio, crie também `APP_URL` com ele (ex.: `https://tarefas.darmand.com.br`); sem isso, o sistema usa o domínio gerado pelo Railway.
5. Pronto: o aviso "Veja suas tarefas no Google Agenda" aparece para cada pessoa no Início.

O sistema guarda só a permissão de cada pessoa (refresh token), cifrada com uma chave derivada de `SESSION_SECRET`. Se `SESSION_SECRET` mudar, todos precisam conectar de novo. Ao desconectar, o sistema remove da agenda os eventos que criou e revoga a permissão.

**Google Tarefas:** dá para ligar do mesmo jeito (a API do Google Tasks também aceita criar e atualizar tarefas), mas ela só tem data de entrega, sem início. Fica como próximo passo, se fizer falta.

Para conferir qual versão está no ar: `GET /healthz`.

## Arquivos

| Arquivo | O que é |
|---|---|
| `server.js` | servidor (Node + Express), login Google, API e banco |
| `agenda.js` | Google Agenda: conexão de cada pessoa e sincronização das tarefas com a agenda principal |
| `ia.js` | Narrar: instruções e formato da resposta da IA (modelo `claude-opus-5-5`) |
| `public/app.html` | a tela do sistema |
| `public/login.html` | tela de entrada |
| `public/marca/` | logo e ícones DARMAND |
| `ferramentas/dev.js` | modo de teste no computador |
