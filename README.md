# Tarefas e Prazos · DARMAND

Gestão de tarefas, controle de equipe e prazos, no Railway. É um sistema **separado** do Portal do Gerente: tem pasta, repositório, serviço e banco próprios.

## O que tem

- **Início ("Meu dia"):** o lugar para abrir e saber o que tem no dia. Resumo ("Hoje você tem 3 compromissos, 2 tarefas e 1 lembrete") com o **próximo compromisso** e botão para entrar no Meet; **Hoje** com os compromissos do Google Agenda (com horário) e o que fazer hoje (tarefas e lembretes); aviso de **atrasadas** recolhido; ao lado **Para aprovar** (quando houver) e **Próximos dias**. Lembretes sem data, todas as tarefas e as que passei para outros ficam recolhidos no fim. Os compromissos vêm da agenda principal de quem conectou o Google Agenda (os eventos que o próprio sistema criou e as reuniões recusadas ficam de fora); atualizam a cada 2 minutos ou no botão ↻.
- **📅 Reuniões pela plataforma:** botão **📅 Reunião** no Início (ou **+ Reunião** no bloco Hoje): assunto, data, horário, convidados da equipe ou e-mails de fora, local e link do **Google Meet** criado sozinho. A reunião entra na agenda de quem criou e o Google envia os convites. O **Narrar** também entende ("marca uma reunião amanhã às 14h com a Ana e o Bruno sobre a vitrine") e mostra a reunião para conferir antes de criar. Precisa do Google Agenda conectado.
- **Anotar rápido:** no topo do Início, escreva e escolha **+ Tarefa** (para você) ou **📌 Lembrete** (só você vê), com data e repetição opcionais; o 🎙 abre o Narrar. Lembretes com data aparecem no dia certo em Hoje ou Próximos dias.
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

## Gestão unificada: portal + tarefas

O sistema passou a ter **módulos** numa barra lateral: **Início · Vendas · Produto · Pessoas · Tarefas** (e **Admin** para a diretoria). Cada módulo tem abas no topo.

- **Vendas, Produto, Pessoas e Admin** são as telas do Portal do Gerente. A página do portal (`portal/painel-lojas.html`) abre dentro da Gestão, num quadro, sem o menu vermelho. Os dados ficam na tabela `docs` (coleção + id + JSON), no mesmo formato do portal antigo, e as rotas ficam em `/papi/...` (arquivo `portal.js`).
- **Quem vê:** a diretoria (`ADMIN_EMAILS`) vê todas as lojas; quem está vinculado a uma loja vê os dados; os demais só veem Início e Tarefas.
- **Tarefa diária:** continua gravando em `POST /api/ingest`, com o token `INGEST_TOKEN`. Só muda o endereço.
- **Comunicado que vira tarefa:** em Pessoas → Comunicados, a diretoria marca **Exigir ação** e o prazo. Cada gerente recebe uma tarefa (prioridade Alta) e a diretoria acompanha por loja: quem concluiu, quem está fazendo, quem não começou. O botão **Lembrar quem não fez** sobe a tarefa para Urgente.
- **Início:** mostra a loja no mês (ou a rede, para a diretoria), os comunicados sem "Ciente" e, para a diretoria, as lojas abaixo do ritmo com o botão **Plano de ação**.

### Testar no computador

`npm run dev` carrega os dados das lojas da pasta da tarefa diária (`%LOCALAPPDATA%\DarmandPainel\kit\export` e `kit\db`), quando ela existe. Entradas de teste: `gestor@darmand.com.br` (diretoria), `gerente@darmand.com.br` (Macapá) e `gerente2@darmand.com.br` (Marabá).

### Mudança do portal antigo (uma vez)

Os módulos do portal só aparecem quando existem dados de lojas no banco. Para trazer tudo do portal antigo:

1. No serviço, crie `INGEST_TOKEN` com o **mesmo valor** que o portal antigo usa.
2. Na subida seguinte, o sistema busca todos os dados no portal antigo, pelas rotas `/api/ingest/lista`, `/api/ingest/doc` e `/api/ingest/usuarios` (protegidas pelo token), e grava no banco próprio: vendas, metas, comunicados, cientes, vínculos de gerentes, personagens. Os gerentes vinculados entram na equipe.
3. A cópia só acontece enquanto o banco próprio não tem lojas. As lojas vêm por último: se a cópia parar no meio, ela recomeça sozinha (a cada 2 minutos, e a cada nova subida).
4. Confira em `/healthz`: `portal.lojas` fica `true` e `portal.importacao` mostra o andamento.
5. Aponte a tarefa diária para este endereço (arquivo `railway.json` da pasta `.darmand-portal`, na pasta do usuário do Windows).
6. Depois de uma carga diária conferida, o projeto do portal antigo pode ser apagado.

Quem é "diretoria" nos módulos do portal é quem está em `ADMIN_EMAILS` deste serviço.

## Níveis de acesso

Em **Admin → Pessoas e acessos** (só o administrador geral vê), cada pessoa tem um nível:

| Nível | O que vê | O que faz |
|---|---|---|
| **Administrador geral** | Tudo, todas as lojas | Define o acesso de todo mundo. Quem está em `ADMIN_EMAILS` é sempre administrador e não pode ser alterado pela tela. |
| **Diretoria** | Todas as lojas, em detalhe | Escreve comunicados e define metas. Não mexe nos acessos. |
| **Gerente de loja** | A própria loja em detalhe e a comparação com as outras (Grupo, corrida, pódios) | Cadastra a meta da loja e recebe as tarefas dos comunicados. |
| **Equipe** | Só Início e Tarefas | Se o administrador marcar módulos, só consulta: uma loja ou todas. |

- **Ajuste fino:** em cada pessoa dá para marcar quais módulos ela vê além de Tarefas (Vendas, Produto, Pessoas). Ex.: fábrica com Produto de todas as lojas, sem Vendas.
- **No servidor:** quem não é da diretoria recebe os totais de venda e meta de todas as lojas (para a comparação), mas o detalhe das outras lojas não sai do servidor: estoque e movimentação só da própria loja, e da análise das outras só a venda e os vendedores por dia (sem produtos, pagamentos e horários).
- **Limite conhecido:** o corte por módulo vale nas telas. Quem tem Produto e não tem Vendas não vê as telas de Vendas, mas os totais de venda continuam chegando ao navegador dele, porque as telas de Produto usam esses dados.
- "Gestor de tarefas" e "Pode entrar" ficam na mesma tela.
