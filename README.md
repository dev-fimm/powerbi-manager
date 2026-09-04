# Gestor de Painéis Power BI

Sistema web para gerenciar **usuários**, **contratos** e os **iframes públicos do Power BI** vinculados a cada contrato, com controle de acesso por perfil.

- **Backend:** Node.js + Express + TypeScript + Prisma + PostgreSQL, autenticação JWT
- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Renderização dos painéis:** `<iframe>` cujo `src` aponta para uma rota de embed da própria API (a URL do Power BI **não** é exposta ao cliente — ver [Segurança do embed](#segurança-do-embed))

> 📘 Este README é o guia de **instalação e uso**. Para a **documentação técnica completa**
> (arquitetura, modelo de dados, modelo de segurança em camadas e referência da API detalhada),
> veja [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md).

---

## Sumário

- [Estrutura do projeto](#estrutura-do-projeto)
- [Pré-requisitos](#pré-requisitos)
- [Instalação e execução](#instalação-e-execução)
- [Credenciais do seed](#credenciais-do-seed)
- [Política de senha](#política-de-senha)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Regras de negócio](#regras-de-negócio)
- [Perfis de acesso](#perfis-de-acesso)
- [Controle de acesso avançado](#controle-de-acesso-avançado)
- [Segurança do embed](#segurança-do-embed)
- [Auditoria (logs)](#auditoria-logs)
- [Endpoints da API](#endpoints-da-api)
- [Como obter a URL pública do Power BI](#como-obter-a-url-pública-do-power-bi)
- [Docker](#docker)
- [Solução de problemas](#solução-de-problemas)

---

## Estrutura do projeto

```
powerbi-manager/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma        # modelo de dados (PostgreSQL)
│   │   └── seed.ts              # seed inicial
│   ├── src/
│   │   ├── config/env.ts        # variáveis de ambiente
│   │   ├── lib/prisma.ts        # cliente Prisma
│   │   ├── middlewares/
│   │   │   ├── auth.ts          # autenticação JWT
│   │   │   ├── rbac.ts          # controle de acesso por role
│   │   │   └── error.ts         # tratamento global de erros
│   │   ├── routes/              # auth, users, contracts, iframes, viewer, dashboard, logs
│   │   ├── utils/
│   │   │   ├── powerbi.ts       # validação da URL do Power BI
│   │   │   ├── screens.ts       # catálogo de telas (permissões por conta)
│   │   │   ├── embed.ts         # token de embed (oculta a URL do Power BI)
│   │   │   ├── audit.ts         # registro de auditoria
│   │   │   └── serialize.ts     # DTOs (camelCase → snake_case)
│   │   ├── validators/schemas.ts# validação de payloads (zod)
│   │   ├── app.ts
│   │   └── server.ts
│   ├── Dockerfile
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── components/          # Layout, ProtectedRoute, UI (Button, Modal, Table, Card, Field)
    │   ├── contexts/            # AuthContext, ToastContext
    │   ├── lib/                 # api.ts (HTTP+JWT), format.ts, screens.ts
    │   ├── pages/               # Login, Dashboard, Users, Contracts, Iframes, Paineis, Permissions, Logs
    │   └── types/
    ├── Dockerfile
    ├── nginx.conf
    └── .env.example
```

---

## Pré-requisitos

- **Node.js 20+** (testado com 22)
- **PostgreSQL 14+** em execução
- npm 10+

---

## Instalação e execução

### 1. Banco de dados

Crie o banco no PostgreSQL:

```sql
CREATE DATABASE powerbi_manager;
```

### 2. Backend

```bash
cd backend

# instalar dependências
npm install

# configurar ambiente 
cp .env.example .env
# edite o .env: ajuste DATABASE_URL e defina um JWT_SECRET forte

# criar as tabelas
npx prisma migrate dev --name init

# popular com dados iniciais (admin, contratos e iframes de exemplo)
npm run seed

# subir a API em modo desenvolvimento
npm run dev
```

A API sobe em **http://localhost:3333/api**. Teste com `curl http://localhost:3333/api/health`.

### 3. Frontend

Em outro terminal:

```bash
cd frontend

npm install

cp .env.example .env
# em desenvolvimento você pode deixar VITE_API_URL vazio:
# o Vite já faz proxy de /api para http://localhost:3333

npm run dev
```

O frontend sobe em **http://localhost:5173**.

### Scripts disponíveis

**backend**

| Comando | Descrição |
|---|---|
| `npm run dev` | API com hot reload (tsx watch) |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Roda a versão compilada |
| `npm run typecheck` | Checagem de tipos sem emitir |
| `npm run seed` | Executa o seed |
| `npm run prisma:migrate` | Cria/aplica migração em dev |
| `npm run prisma:deploy` | Aplica migrações em produção |
| `npm run prisma:studio` | Abre o Prisma Studio |

**frontend**

| Comando | Descrição |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + build de produção |
| `npm run preview` | Serve o build localmente |

---

## Credenciais do seed

| Perfil | E-mail | Senha | Acesso |
|---|---|---|---|
| ADMIN | `admin@sistema.com` | `admin123` | Total |
| GESTOR | `gestor@sistema.com` | `gestor123` | Os 2 contratos de exemplo |
| VISUALIZADOR | `viewer@sistema.com` | `viewer123` | Apenas o contrato de Saneamento |

> **Troque essas senhas antes de colocar em produção.** Elas são públicas neste repositório e
> **não** atendem à [política de senha](#política-de-senha) — o próprio `npm run seed` avisa isso
> no terminal. Cada usuário troca a própria senha em **Alterar senha**, no topo da tela.

> ℹ️ O acesso do **VISUALIZADOR** aos painéis é **por dashboard** (modelo explícito): por padrão
> ele não vê nenhum painel. Libere os painéis desejados na tela **Permissões → Acesso aos Paineis**.
> Ver [Controle de acesso avançado](#controle-de-acesso-avançado).

O seed também cria 2 contratos e 3 iframes de exemplo. As URLs do Power BI usadas são **placeholders no formato correto** (`https://app.powerbi.com/view?r=...`) — substitua pelos links reais dos seus relatórios para que os painéis carreguem.

---

## Política de senha

Vale para toda senha definida pela aplicação (cadastro de usuário, redefinição pelo ADMIN e troca pelo próprio usuário). Senhas já existentes no banco continuam válidas para login — **não há rotação forçada**.

| Regra | Motivo |
|---|---|
| Mínimo de **10 caracteres** | Comprimento é o fator que mais encarece um ataque de força bruta |
| Máximo de **72 caracteres** | O bcrypt ignora o que passa de 72 bytes; sem esse teto a senha seria truncada em silêncio |
| Ao menos **3 dos 4 tipos**: minúscula, maiúscula, número, símbolo | Exigir os 4 empurra todo mundo para o previsível `Senha123!` |
| Não estar na lista de **senhas comuns** | Inclui `admin123`, `senha123` e as demais credenciais do seed |
| Sem **4 caracteres iguais seguidos** | Barra o preenchimento preguiçoso (`aaaa`) |
| Não conter o **nome** nem o **e-mail** do usuário | É o primeiro palpite de quem conhece a vítima |

A tela mostra cada regra e marca as que já foram atendidas enquanto o usuário digita — em vez de recusar o formulário revelando uma exigência por vez.

### Definindo a senha: digitar ou gerar

Na tela de **Usuários** há as duas opções, sobre o mesmo campo:

- **Digitar** — comportamento normal, com a validação em tempo real.
- **Gerar senha** — preenche o campo com uma senha aleatória de 16 caracteres que já atende à política. O campo continua editável depois de gerado.

Junto do botão ficam **Mostrar/Ocultar** e **Copiar**: uma senha gerada precisa ser lida para ser repassada ao usuário, e depois de salva não há como consultá-la (fica só o hash).

A geração usa `crypto.getRandomValues` (CSPRNG do navegador), **não** `Math.random()`, com amostragem por rejeição para não enviesar a escolha dos caracteres. O alfabeto omite `0`, `O`, `1`, `l` e `I` de propósito: a senha quase sempre é ditada ou transcrita, e confundir `l` com `1` vira chamado de suporte.

> O gerador **não** foi adicionado à tela "Alterar senha" do próprio usuário. Lá o risco se inverte: quem gera uma senha para si e não a guarda perde o acesso à própria conta, sem um admin no meio do caminho para corrigir.

**Trocar a própria senha:** botão **Alterar senha** no topo, disponível para qualquer perfil. Exige a senha atual, mesmo com a sessão já autenticada — é o que impede que um token roubado vire posse permanente da conta.

**Redefinir a senha de um ADMIN:** exige que o administrador confirme a própria senha. Sem isso, um admin assumiria a conta de outro em silêncio e passaria a agir na auditoria com o nome dele. Contas GESTOR e VISUALIZADOR seguem no fluxo normal de reset.

> Ainda **não** existe "esqueci minha senha" por e-mail: isso depende de infraestrutura de envio (SMTP) que o projeto não tem. Hoje a recuperação é feita por um ADMIN, pela tela de Usuários.

Definida em [`backend/src/utils/password.ts`](backend/src/utils/password.ts) e espelhada em [`frontend/src/lib/password.ts`](frontend/src/lib/password.ts) — **as duas precisam ser alteradas juntas**, sendo o backend a fonte da verdade.

---

## Variáveis de ambiente

### backend/.env

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | String de conexão do PostgreSQL |
| `JWT_SECRET` | sim | Segredo de assinatura do token. Gere com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | não | Validade do token (padrão `8h`) |
| `BCRYPT_SALT_ROUNDS` | não | Custo do hash (padrão `10`) |
| `PORT` | não | Porta da API (padrão `3333`) |
| `NODE_ENV` | não | `development` ou `production` |
| `CORS_ORIGIN` | não | Origens permitidas, separadas por vírgula, ou `*` |
| `AUDIT_LOG_RETENTION_DAYS` | não | Dias de retenção dos logs de auditoria (padrão `365`; `0` desliga o expurgo) |
| `SEED_ADMIN_*` | não | Nome, e-mail e senha do admin criado pelo seed |

### frontend/.env

| Variável | Descrição |
|---|---|
| `VITE_API_URL` | URL base da API. Deixe vazio em dev para usar o proxy do Vite |
| `VITE_PROXY_TARGET` | Alvo do proxy do Vite (padrão `http://localhost:3333`) |

---

## Regras de negócio

1. **Autenticação obrigatória** — todas as rotas exigem JWT válido, exceto `POST /api/auth/login`.
2. **Controle por perfil** — ADMIN, GESTOR e VISUALIZADOR (detalhado abaixo).
3. **Iframe sempre pertence a um contrato** — `contract_id` é obrigatório; não existe iframe órfão.
4. **Validação da URL do Power BI** — só são aceitas URLs `https://app.powerbi.com/view` ou `https://app.powerbi.com/reportEmbed`. A validação usa o parser de URL (protocolo + host exatos), então tentativas como `https://app.powerbi.com.dominio-falso.com/view` são rejeitadas.
5. **Iframe inativo não aparece** — `is_active = false` some da listagem pública e da tela Paineis.
6. **Contrato encerrado bloqueia a tela Paineis** — com `status = ENCERRADO`, nenhum painel do contrato é exibido, mesmo com `is_active = true`.
7. **Cascade delete** — excluir um contrato remove seus iframes e as associações de usuário; excluir um usuário remove apenas as associações, **nunca** os contratos.

Também estão implementados: usuário desativado perde acesso imediatamente (o token é revalidado contra o banco a cada requisição), e o ADMIN logado não consegue se auto-excluir, se desativar nem rebaixar o próprio perfil.

---

## Perfis de acesso

| Ação | ADMIN | GESTOR | VISUALIZADOR |
|---|:--:|:--:|:--:|
| Gerenciar usuários | ✅ | ❌ | ❌ |
| Listar contratos | todos | associados | associados |
| Criar contrato | ✅ | ✅ | ❌ |
| Editar contrato | ✅ | só os associados | ❌ |
| Excluir contrato | ✅ | ❌ | ❌ |
| Criar/editar/excluir iframe | ✅ | só nos contratos associados | ❌ |
| Visualizar painéis (tela **Paineis**) | todos | dos contratos associados | **só os painéis concedidos** |

> Quando um GESTOR cria um contrato, ele é automaticamente associado a si mesmo — caso contrário perderia o acesso ao que acabou de criar.

---

## Controle de acesso avançado

Além do perfil (RBAC), há dois controles **por conta**, gerenciados na tela **Permissões** (só ADMIN):

### Permissões de tela (menu)
Define **quais telas** aparecem no menu de cada conta e o acesso direto por URL. Substitui o menu padrão do perfil.

- **ADMIN** sempre acessa todas as telas (não pode ser restringido).
- Telas **configuráveis**: `Dashboard`, `Contratos`, `Iframes`, `Paineis`.
- Telas **exclusivas de ADMIN** (nunca liberadas a outros perfis): `Usuários`, `Permissões`, `Logs`.
- É controle de **navegação** (frontend). A autorização de **dados** continua sendo por perfil no backend.

**Telas iniciais de uma conta nova:** GESTOR e VISUALIZADOR são criados com acesso **apenas a `Paineis`**. `Dashboard`, `Contratos` e `Iframes` são liberados depois, conta a conta, aqui em Permissões.

É privilégio mínimo: a conta nasce com o necessário para a finalidade dela e cresce por decisão explícita. Antes, toda conta nova já vinha com as quatro telas — na prática ninguém *removia* acesso, apenas esquecia de remover.

> Contas **já existentes não são afetadas** — a regra vale no momento da criação. A exceção é o rebaixamento de um ADMIN para GESTOR/VISUALIZADOR: aí as telas voltam ao padrão do novo perfil, senão a conta manteria a lista completa que tinha como administrador.

### Acesso por dashboard (só VISUALIZADOR)
Distribui, por conta, **quais painéis** um VISUALIZADOR vê na tela **Paineis** (Permissões → "Acesso aos Paineis").

- Modelo **explícito**: sem concessão, o VISUALIZADOR **não vê nenhum painel**.
- Só se aplica ao VISUALIZADOR. GESTOR vê todos os painéis dos contratos associados; ADMIN vê tudo.
- Aplicado no **backend** (rotas do viewer e no resumo do dashboard).

---

## Segurança do embed

Para que o link público do Power BI (`?r=...`) não fique exposto na interface:

1. A resposta do viewer **omite** `power_bi_url` e envia um **`embed_token`** curto (validade ~1h, específico do painel).
2. O `<iframe>` aponta para `GET /api/viewer/iframes/:id/embed?t=<token>` — rota **pública** (o navegador não envia `Authorization` num iframe), que valida o token e **redireciona (302)** para a URL real.

**Protege:** a URL real não aparece no JSON da API nem no `src` do iframe; o token só é emitido após validar o acesso da conta.

**Limitação:** por ser "Publicar na web", a URL ainda aparece no header `Location` do redirect (visível na aba Network do DevTools). Ocultação total exige **Power BI Embedded** — ver [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md).

---

## Auditoria (logs)

Todas as ações relevantes são registradas na tabela `audit_logs` e consultadas na tela **Logs** (só ADMIN), com filtros (ação, usuário, texto, datas) e paginação.

Ações registradas: `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `PAGE_VIEW` (tela acessada), `PASSWORD_CHANGE` (troca pelo próprio usuário), `PASSWORD_RESET` (redefinição por um ADMIN), `AUDIT_PURGE` (expurgo automático), e as operações de `USER_*`, `CONTRACT_*` e `IFRAME_*` (criar/editar/excluir), além de `USER_CONTRACTS`, `USER_SCREENS` e `USER_IFRAMES`.

### Retenção

Os logs guardam **IP e user-agent** — dado pessoal. Guardá-los indefinidamente amplia o estrago de um vazamento do banco sem benefício operacional e contraria o princípio da LGPD de não reter além da finalidade. Também há um motivo prático: o `PAGE_VIEW` registra **cada navegação de cada usuário**, então a tabela cresce sem limite.

Um job apaga os registros mais antigos que `AUDIT_LOG_RETENTION_DAYS` (padrão **365 dias**). Ele roda na inicialização da API e depois a cada 24 h. Use `AUDIT_LOG_RETENTION_DAYS=0` para desligar, por exemplo quando houver exigência contratual de guarda.

O próprio expurgo fica registrado como `AUDIT_PURGE` — sem isso, um buraco no histórico seria indistinguível de adulteração.

---

## Endpoints da API

Todas as rotas usam o prefixo `/api` e exigem o header `Authorization: Bearer <token>`, exceto o login.

### Autenticação
| Método | Rota | Acesso |
|---|---|---|
| POST | `/api/auth/login` | público |
| POST | `/api/auth/logout` | autenticado (registra auditoria) |
| POST | `/api/auth/register` | ADMIN |
| POST | `/api/auth/change-password` | autenticado — body `{ "current_password": "", "new_password": "" }` |
| GET | `/api/auth/me` | autenticado |

### Usuários (ADMIN)
| Método | Rota |
|---|---|
| GET | `/api/users` |
| GET | `/api/users/:id` |
| POST | `/api/users` |
| PUT | `/api/users/:id` — redefinir a senha de uma conta **ADMIN** exige também `current_password` (a senha de quem está executando) |
| DELETE | `/api/users/:id` |
| PUT | `/api/users/:id/contracts` — body `{ "contract_ids": [] }` |
| PUT | `/api/users/:id/screens` — body `{ "screens": [] }` (telas do menu; rejeita ADMIN) |
| GET | `/api/users/:id/iframes` — retorna `{ "iframe_ids": [] }` concedidos |
| PUT | `/api/users/:id/iframes` — body `{ "iframe_ids": [] }` (só VISUALIZADOR) |

### Contratos
| Método | Rota | Acesso |
|---|---|---|
| GET | `/api/contracts` (filtros: `?status=`, `?search=`) | autenticado |
| GET | `/api/contracts/:id` | autenticado com acesso |
| POST | `/api/contracts` | ADMIN, GESTOR |
| PUT | `/api/contracts/:id` | ADMIN, GESTOR |
| DELETE | `/api/contracts/:id` | ADMIN |
| GET | `/api/contracts/:id/iframes` | autenticado com acesso |

### Iframes
| Método | Rota | Acesso |
|---|---|---|
| GET | `/api/iframes` (filtros: `?contract_id=`, `?is_active=`, `?search=`) | autenticado |
| GET | `/api/iframes/:id` | autenticado com acesso |
| POST | `/api/iframes` | ADMIN, GESTOR |
| PUT | `/api/iframes/:id` | ADMIN, GESTOR |
| DELETE | `/api/iframes/:id` | ADMIN, GESTOR |

### Viewer (tela "Paineis")
| Método | Rota | Acesso |
|---|---|---|
| GET | `/api/viewer/contracts` | autenticado (VISUALIZADOR: por concessão) |
| GET | `/api/viewer/contracts/:id/iframes` | autenticado (retorna `embed_token`, sem `power_bi_url`) |
| GET | `/api/viewer/iframes/:id/embed?t=<token>` | **público** (token de embed) → 302 para o Power BI |

### Dashboard
| Método | Rota |
|---|---|
| GET | `/api/dashboard/summary` |

### Logs (auditoria)
| Método | Rota | Acesso |
|---|---|---|
| POST | `/api/logs/page-view` — body `{ "path": "", "label": "" }` | autenticado (qualquer perfil) |
| GET | `/api/logs` (filtros: `?action=`, `?user_id=`, `?search=`, `?from=`, `?to=`, `?page=`, `?page_size=`) | ADMIN |

### Exemplo

```bash
# login
TOKEN=$(curl -s -X POST http://localhost:3333/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@sistema.com","password":"admin123"}' | jq -r .token)

# listar contratos
curl http://localhost:3333/api/contracts -H "Authorization: Bearer $TOKEN"

# criar iframe
curl -X POST http://localhost:3333/api/iframes \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "title": "Painel Comercial",
    "power_bi_url": "https://app.powerbi.com/view?r=eyJrIjoi...",
    "description": "Vendas por região",
    "contract_id": "<uuid-do-contrato>"
  }'
```

Respostas de erro seguem o formato `{ "message": "...", "errors": [{ "field": "...", "message": "..." }] }`, consumido pelos toasts do frontend.

---

## Como obter a URL pública do Power BI

1. Abra o relatório no **Power BI Service**.
2. Menu **Arquivo → Inserir relatório → Publicar na web (público)**.
3. Confirme a criação do código de inserção.
4. Copie o **link** (ou o `src` do iframe) — ele terá o formato `https://app.powerbi.com/view?r=...`.
5. Cole no campo "URL pública do Power BI" ao cadastrar o iframe.

> ⚠️ **Atenção:** "Publicar na web" torna o relatório **acessível a qualquer pessoa com o link**, sem autenticação. Não use com dados confidenciais. Para dados sensíveis, avalie o Power BI Embedded com service principal.

---

## Docker

Os dois Dockerfiles são multi-stage e prontos para deploy. É necessário um PostgreSQL acessível.

```bash
# backend
cd backend
docker build -t powerbi-manager-api .
docker run -d --name pbi-api -p 3333:3333 \
  -e DATABASE_URL="postgresql://usuario:senha@host:5432/powerbi_manager" \
  -e JWT_SECRET="seu-segredo-forte" \
  -e CORS_ORIGIN="https://app.suaempresa.com" \
  powerbi-manager-api

# frontend (a URL da API é embutida no build)
cd ../frontend
docker build --build-arg VITE_API_URL=https://api.suaempresa.com/api -t powerbi-manager-web .
docker run -d --name pbi-web -p 8080:80 powerbi-manager-web
```

O container do backend roda `prisma migrate deploy` antes de subir a API. O seed deve ser executado manualmente uma única vez:

```bash
docker exec -it pbi-api npx prisma db seed
```

> ⚠️ Este comando **não funciona na imagem de produção**: o seed roda via `tsx` e importa arquivos de `src/`, e nenhum dos dois existe na imagem final (que só contém `dist/` e as dependências de produção). Rode o seed a partir do host, com `npm run seed` e o `DATABASE_URL` apontando para o banco do container. Corrigir isso exige compilar o seed junto do build — fora do escopo desta rodada.

O `nginx.conf` do frontend já faz proxy de `/api/` para `http://backend:3333/api/` — ajuste o host conforme a sua rede. Se preferir apontar direto para a API pública, use o `--build-arg VITE_API_URL` e ignore o bloco de proxy.

### HTTPS

O container do frontend escuta em HTTP porque quem termina o TLS é a camada da frente (load balancer, ingress ou proxy reverso). Essa camada precisa enviar `X-Forwarded-Proto`; quando ele chega como `http`, o nginx redireciona para HTTPS (301) e envia `Strict-Transport-Security` por 1 ano.

Sem proxy na frente, o header não existe e nada é redirecionado — o ambiente local continua funcionando.

Isso importa mais aqui do que numa aplicação comum: o **token de embed dos painéis viaja na query string**, e em HTTP ele fica legível para qualquer um no caminho da rede.

> `includeSubDomains` só deve ficar ligado se **todos** os subdomínios tiverem HTTPS. O efeito dura 1 ano no navegador de quem já recebeu o header e não há como voltar atrás.

### Usuário do container

A imagem da API roda como o usuário não privilegiado `node` (uid 1000), não como root — rodar como root significa que qualquer execução remota de código na API começaria com privilégio total dentro do container. Ambas as imagens têm `HEALTHCHECK`, para o orquestrador distinguir "processo vivo" de "aplicação respondendo".

O CLI do Prisma passou de `devDependency` para dependência de produção: sem isso, o `npx prisma migrate deploy` do `CMD` **baixaria o pacote da internet a cada start** do container — o que falha sob usuário não privilegiado e torna a subida dependente de rede externa.

---

## Solução de problemas

**`Can't reach database server`** — confira o `DATABASE_URL` e se o PostgreSQL está aceitando conexões na porta configurada.

**`Variável de ambiente obrigatória ausente: DATABASE_URL`** — você esqueceu de copiar o `.env.example` para `.env`.

**Erro de CORS no navegador** — inclua a origem do frontend em `CORS_ORIGIN` no backend, ou use o proxy do Vite deixando `VITE_API_URL` vazio em desenvolvimento.

**O painel aparece em branco na tela Paineis** — as URLs do seed são placeholders. Cadastre um link real de "Publicar na web". Se o link for real e ainda assim não carregar, verifique se a publicação pública não foi revogada no Power BI e se nenhuma política de rede da empresa bloqueia `app.powerbi.com`. Para o **VISUALIZADOR**, confirme também que o painel foi **concedido** à conta em Permissões → "Acesso aos Paineis".

**`Sessão expirada`** logo após entrar — o `JWT_SECRET` mudou entre reinícios (por exemplo, ficou sem `.env`). Defina um valor fixo.

**Erro ao rodar migração após alterar o schema** — em desenvolvimento, `npx prisma migrate dev` recria o histórico; em produção use sempre `npx prisma migrate deploy`.
