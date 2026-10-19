# Documentação Técnica — Gestor de Painéis Power BI

> Documentação de arquitetura, modelo de dados, segurança e API.
> Para instalação e execução rápida, veja o [README.md](../README.md).
>
> **Última atualização:** reflete o estado atual do projeto, incluindo auditoria,
> permissões de tela por conta, acesso por dashboard, segurança do embed,
> proteção contra força bruta no login e o monitoramento de uso por heartbeat.

---

## Sumário

- [1. Visão geral](#1-visão-geral)
- [2. Arquitetura e stack](#2-arquitetura-e-stack)
- [3. Estrutura de pastas](#3-estrutura-de-pastas)
- [4. Modelo de dados](#4-modelo-de-dados)
- [5. Modelo de segurança e controle de acesso](#5-modelo-de-segurança-e-controle-de-acesso)
- [6. Segurança do embed (ocultação do link do Power BI)](#6-segurança-do-embed-ocultação-do-link-do-power-bi)
- [7. Auditoria (logs)](#7-auditoria-logs)
- [8. Monitoramento de uso (medição de tempo)](#8-monitoramento-de-uso-medição-de-tempo)
- [9. Referência da API](#9-referência-da-api)
- [10. Frontend: páginas, rotas e telas](#10-frontend-páginas-rotas-e-telas)
- [11. Migrações de banco](#11-migrações-de-banco)
- [12. Evolução recomendada (Power BI Embedded)](#12-evolução-recomendada-power-bi-embedded)

---

## 1. Visão geral

Sistema web para gerenciar **usuários**, **contratos** e **painéis do Power BI**
(iframes) vinculados a cada contrato, com múltiplas camadas de controle de acesso.

Cada painel é um relatório do Power BI publicado. O sistema controla **quem** pode
ver **quais** painéis e **quais telas** cada conta enxerga, além de registrar as
ações dos usuários para auditoria.

---

## 2. Arquitetura e stack

```
┌────────────────────┐        HTTP/JSON + JWT        ┌────────────────────┐
│     Frontend       │  ─────────────────────────▶   │      Backend       │
│  React + Vite + TS │                                │ Express + TS       │
│  Tailwind CSS      │  ◀─────────────────────────    │ Prisma ORM         │
└────────────────────┘                                └─────────┬──────────┘
        │                                                        │
        │ <iframe src=.../embed?t=token>                         │ Prisma
        ▼                                                        ▼
   Power BI (app.powerbi.com)                            PostgreSQL
```

| Camada | Tecnologias |
|---|---|
| **Backend** | Node.js, Express, TypeScript, Prisma, PostgreSQL, JWT (jsonwebtoken), bcryptjs, Zod, Helmet, CORS, Morgan |
| **Frontend** | React, TypeScript, Vite, Tailwind CSS, React Router |
| **Banco** | PostgreSQL |
| **Auth** | JWT (Bearer), revalidado contra o banco a cada requisição |

---

## 3. Estrutura de pastas

```
powerbi-manager/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma         # modelo de dados
│   │   ├── migrations/           # histórico de migrações
│   │   └── seed.ts               # dados iniciais
│   ├── src/
│   │   ├── config/env.ts         # variáveis de ambiente
│   │   ├── lib/prisma.ts         # cliente Prisma
│   │   ├── middlewares/
│   │   │   ├── auth.ts           # autenticação JWT
│   │   │   ├── rbac.ts           # controle de acesso por perfil + helpers de escopo
│   │   │   └── error.ts          # tratamento global de erros
│   │   ├── routes/
│   │   │   ├── auth.routes.ts     # login, logout, register, me
│   │   │   ├── users.routes.ts    # CRUD + contracts/screens/iframes por usuário
│   │   │   ├── contracts.routes.ts
│   │   │   ├── iframes.routes.ts
│   │   │   ├── viewer.routes.ts   # telas de painéis + rota pública de embed
│   │   │   ├── dashboard.routes.ts
│   │   │   ├── logs.routes.ts     # page-view + heartbeat + consulta de auditoria
│   │   │   └── monitoring.routes.ts # agregações da tela de Monitoramento
│   │   ├── utils/
│   │   │   ├── powerbi.ts         # validação da URL do Power BI
│   │   │   ├── screens.ts         # catálogo de telas (permissões por conta)
│   │   │   ├── embed.ts           # token de embed (curto)
│   │   │   ├── audit.ts           # registro de auditoria
│   │   │   ├── auditRetention.ts  # expurgo por retenção (logs, sessões, contadores)
│   │   │   ├── accessSession.ts   # sessões de uso medidas por heartbeat
│   │   │   ├── monitoring.ts      # helpers de período e agregação
│   │   │   ├── loginThrottle.ts   # contagem de tentativas + bloqueio progressivo
│   │   │   └── serialize.ts       # DTOs (camelCase → snake_case)
│   │   ├── validators/schemas.ts  # validação de payloads (Zod)
│   │   ├── app.ts
│   │   └── server.ts
│   └── Dockerfile
└── frontend/
    ├── src/
    │   ├── components/            # Layout, ProtectedRoute, UI (Button, Modal, Table, Card, Field, PaginatedTable)
    │   ├── contexts/             # AuthContext, ToastContext
    │   ├── lib/
    │   │   ├── api.ts            # cliente HTTP com JWT
    │   │   ├── format.ts        # rótulos e formatação
    │   │   ├── charts.ts        # paleta validada + formatação dos gráficos
    │   │   ├── heartbeat.ts     # sinal periódico de sessão (aba visível)
    │   │   └── screens.ts       # catálogo de telas (espelha o backend)
    │   ├── pages/               # Login, Dashboard, Users, Contracts, Iframes, Viewer, Permissions, Logs, Monitoring
    │   └── types/
    ├── Dockerfile
    └── nginx.conf
```

---

## 4. Modelo de dados

Enums: `Role` = `ADMIN | DESENVOLVEDOR | GESTOR | VISUALIZADOR`; `ContractStatus` = `ATIVO | SUSPENSO | ENCERRADO`; `ThrottleScope` = `ACCOUNT | IP`.

### Tabelas

| Tabela | Descrição |
|---|---|
| `users` | Contas do sistema. |
| `contracts` | Contratos (cliente, datas, status). |
| `iframes` | Painéis do Power BI (título, URL, contrato). |
| `user_contracts` | Associação **usuário ↔ contrato** (escopo de dados de GESTOR/VISUALIZADOR). |
| `user_iframes` | Concessão **usuário ↔ painel** (acesso por dashboard, só VISUALIZADOR). |
| `audit_logs` | Registro de auditoria das ações. |
| `access_sessions` | Sessões de uso medidas por heartbeat (ver [seção 8](#8-monitoramento-de-uso-medição-de-tempo)). |
| `session_contract_usage` | Tempo medido **por contrato** dentro de cada sessão. |
| `login_throttle` | Contador de tentativas de login e nível de bloqueio (ver [Proteção contra força bruta](#proteção-contra-força-bruta-no-login)). |

### `users`
| Campo | Tipo | Observações |
|---|---|---|
| `id` | uuid | PK |
| `name`, `email` | string | `email` único |
| `password_hash` | string | bcrypt; nunca é serializado na API |
| `role` | Role | padrão `VISUALIZADOR` |
| `is_active` | bool | conta inativa perde acesso imediatamente |
| `allowed_screens` | string[] | telas liberadas no menu (ver [seção 5](#5-modelo-de-segurança-e-controle-de-acesso)) |
| `created_at`, `updated_at` | datetime | |

### `iframes`
| Campo | Tipo | Observações |
|---|---|---|
| `id` | uuid | PK |
| `title` | string | |
| `power_bi_url` | string | URL do Power BI (validada; **não** é enviada ao viewer) |
| `description` | text? | |
| `contract_id` | uuid | FK obrigatória (todo painel pertence a um contrato) |
| `is_active` | bool | inativo não aparece no viewer |

### `user_iframes` (acesso por dashboard)
Cada linha concede a um VISUALIZADOR o acesso a um painel específico.
`@@unique([userId, iframeId])`. `onDelete: Cascade` em ambos os lados.

### `audit_logs`
Guarda um **snapshot** do autor (`user_name`, `user_email`) para preservar o
histórico mesmo se o usuário for renomeado ou excluído (`user_id` vira `null`,
`onDelete: SetNull`). Campos: `action`, `entity`, `entity_id`, `description`,
`ip_address`, `user_agent`, `created_at`.

### `access_sessions`
| Campo | Tipo | Observações |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → `users`, `onDelete: Cascade` |
| `started_at` | datetime | primeiro sinal da sessão |
| `last_seen_at` | datetime | último sinal recebido; **duração = `last_seen_at − started_at`** |
| `ip_address` | string? | dado pessoal — entra na política de retenção |
| `user_agent` | text? | idem |
| `last_contract_id` | uuid? | contrato exibido no sinal **anterior** |

`last_contract_id` guarda o contrato do sinal anterior, e não o atual, porque o
intervalo entre dois sinais pertence a onde a pessoa **estava durante** o intervalo —
não a onde ela acabou de chegar.

Índices: `(user_id)`, `(user_id, last_seen_at)` (a consulta quente é "sessão aberta
desta conta") e `(started_at)` (recorte por período).

### `session_contract_usage`
| Campo | Tipo | Observações |
|---|---|---|
| `session_id` | uuid | FK → `access_sessions`, `onDelete: Cascade` |
| `contract_id` | uuid | FK → `contracts`, `onDelete: Cascade` |
| `seconds` | int | soma dos intervalos medidos naquele contrato |

`@@unique([sessionId, contractId])`. É **medição, não estimativa**: só entra tempo
que ficou entre dois sinais efetivamente recebidos.

### `login_throttle`
| Campo | Tipo | Observações |
|---|---|---|
| `scope` | ThrottleScope | `ACCOUNT` (e-mail digitado) ou `IP` |
| `key` | string | e-mail normalizado ou endereço de origem; `@@unique([scope, key])` |
| `failures` | int | falhas dentro da janela corrente |
| `window_started_at` | datetime | início da janela de contagem |
| `blocked_until` | datetime? | `null` = sem bloqueio; no passado = bloqueio expirado |
| `block_level` | int | quantas vezes este alvo já foi bloqueado — define a duração do próximo |
| `requires_manual_unlock` | bool | bloqueio sem prazo (último degrau, conforme configuração) |
| `last_failure_at` | datetime | base para zerar o nível após um período longo sem tentativas |
| `updated_at` | datetime | o expurgo varre por aqui (`@@index([updatedAt])`) |

O contador mora **no banco, não em memória**: sobrevive a um restart da API — senão
bastaria derrubar o processo para zerar um bloqueio — e o incremento pode ser
serializado de verdade, sem depender de haver só um processo.

`last_failure_at` existe em separado porque `updated_at` muda em qualquer escrita
futura na linha e, por isso, não serve para medir "tempo sem nenhuma tentativa".

### Regras de integridade (cascade)
- Excluir **contrato** → remove seus `iframes`, as associações `user_contracts`/`user_iframes` e o tempo medido naquele contrato (`session_contract_usage`).
- Excluir **usuário** → remove suas associações, concessões e `access_sessions` (com o tempo por contrato, em cascata); **nunca** remove contratos.
- Excluir **iframe** → remove as concessões `user_iframes` correspondentes.
- Excluir **usuário** → seus `audit_logs` são preservados (autor vira `null`).
- `login_throttle` é independente: a chave é o e-mail **digitado**, que pode não corresponder a conta nenhuma.

---

## 5. Modelo de segurança e controle de acesso

O acesso é controlado em **quatro camadas independentes**:

### Camada 1 — Autenticação (JWT)
Toda rota exige `Authorization: Bearer <token>`, exceto `POST /api/auth/login` e a
rota pública de embed. O token é **revalidado contra o banco a cada requisição**
(`middlewares/auth.ts`): se o usuário for desativado ou excluído, perde o acesso
imediatamente, sem esperar o token expirar.

### Camada 2 — Perfil (RBAC) — autorização de **dados** (backend)
Definido em `middlewares/rbac.ts`. É o limite de segurança dos dados.

| Ação | ADMIN | DESENVOLVEDOR | GESTOR | VISUALIZADOR |
|---|:--:|:--:|:--:|:--:|
| Gerenciar usuários / permissões / logs | ✅ | ✅ (exceto contas ADMIN) | ❌ | ❌ |
| Listar contratos | todos | todos | associados | associados |
| Criar contrato | ✅ | ✅ | ✅ | ❌ |
| Editar contrato | ✅ | ✅ | só associados | ❌ |
| Excluir contrato | ✅ | ✅ | ❌ | ❌ |
| Criar/editar/excluir iframe | ✅ | ✅ | só nos contratos associados | ❌ |
| Visualizar painéis | todos | todos | dos contratos associados | **só os painéis concedidos** |

**`FULL_ACCESS_ROLES` = `[ADMIN, DESENVOLVEDOR]`.** Tudo que decide *alcance de dados*
(todos os contratos, contadores de usuário, telas de gestão) pergunta `hasFullAccess()`,
não `role === ADMIN`. Os dois perfis enxergam o mesmo sistema.

#### Proteção das contas ADMIN
O que separa DESENVOLVEDOR de ADMIN é apenas **quem pode escrever numa conta ADMIN**.
`assertCanManageUser(actor, target)` recusa (`403`) qualquer escrita de um DESENVOLVEDOR
sobre um alvo ADMIN, e está em todas as rotas de escrita de `/users`: `PUT /users/:id`,
`/contracts`, `/screens`, `/iframes` e `DELETE /users/:id`.

`assertCanAssignRole(actor, role)` complementa: um DESENVOLVEDOR **não concede o perfil
ADMIN** a ninguém, nem em `POST /users` / `POST /auth/register`, nem promovendo alguém em
`PUT /users/:id`. Sem esse bloqueio a proteção acima seria contornável em dois passos —
crio um ADMIN com senha conhecida, entro com ele, e então altero os demais
administradores. Contas GESTOR, VISUALIZADOR e DESENVOLVEDOR ele gerencia normalmente.

### Camada 3 — Permissões de tela por conta (`allowed_screens`) — **menu** (frontend)
Controla **quais telas aparecem no menu** de cada conta e o acesso direto por URL.
**Substitui** o menu padrão do perfil.

- **ADMIN** e **DESENVOLVEDOR** sempre acessam todas as telas (não podem ser restringidos).
- Telas **configuráveis** (por conta): `dashboard`, `contracts`, `iframes`, `viewer`.
- Telas **de gestão** (só ADMIN e DESENVOLVEDOR, nunca liberadas aos demais): `users`, `permissions`, `logs`.
- Gerenciada na tela **Permissões** (matriz Usuários × Telas).
- É controle de **navegação** (frontend). A autorização de **dados** continua na Camada 2.

**Padrão na criação** (`defaultScreensForRole`): ADMIN e DESENVOLVEDOR recebem todas as
telas; **GESTOR e VISUALIZADOR recebem apenas `viewer`**. As demais são concedidas depois, explicitamente,
na tela de Permissões. É privilégio mínimo — antes, toda conta nova já nascia com as
quatro telas configuráveis, de modo que o acesso só era removido por exceção.

Aplicado em `POST /users` e em `POST /auth/register` (esta última criava a conta sem
nenhuma tela, deixando o usuário sem destino após o login).

**Rebaixamento de conta de acesso total** (`PUT /users/:id` mudando `role` de
ADMIN/DESENVOLVEDOR para GESTOR/VISUALIZADOR): `allowed_screens` é redefinido para o
padrão do novo perfil. Sem isso a conta manteria a lista completa gravada, e
`effectiveScreens` a filtraria para as quatro telas configuráveis — contornando o padrão
restrito. Trocas entre GESTOR e VISUALIZADOR, ou entre ADMIN e DESENVOLVEDOR, preservam o
que já havia sido concedido.

Contas já existentes não são alteradas: a regra incide na criação (e no rebaixamento).

Catálogo espelhado em `backend/src/utils/screens.ts` e `frontend/src/lib/screens.ts`.

### Camada 4 — Acesso por dashboard (`user_iframes`) — **só VISUALIZADOR**
Distribui, por conta, **quais painéis** um VISUALIZADOR vê na tela **Paineis**.

- Modelo **explícito**: sem concessão, o VISUALIZADOR **não vê nenhum painel**.
- Só se aplica ao VISUALIZADOR. GESTOR vê todos os painéis dos contratos associados; ADMIN e DESENVOLVEDOR veem tudo.
- Aplicado no **backend** (rotas do viewer e no resumo do dashboard).
- Gerenciado na tela **Permissões** → seção "Acesso aos Paineis".

> **Resumo:** Camadas 1 e 2 protegem os **dados** (backend, por perfil). Camada 3 controla o **menu** (por conta). Camada 4 controla **quais painéis** cada VISUALIZADOR vê (por conta, no backend).

### Salvaguardas adicionais
- O ADMIN logado não pode se auto-excluir, se desativar nem rebaixar o próprio perfil.
- A mensagem de erro de login é a mesma para e-mail inexistente, senha errada **e conta inativa** (não revela quais e-mails existem) — ver [Proteção contra força bruta](#proteção-contra-força-bruta-no-login).
- **Política de senha** (`backend/src/utils/password.ts`): mínimo de 10 e máximo de 72 caracteres (o bcrypt trunca acima de 72 bytes), ao menos 3 dos 4 tipos de caractere, bloqueio de senhas comuns e proibição de conter o nome ou o e-mail do próprio usuário. Vale para cadastro, redefinição pelo ADMIN e troca pelo usuário. Senhas já existentes seguem válidas — não há rotação forçada.
- **Gerador de senha** (`frontend/src/lib/password.ts`, `generatePassword`): disponível na tela de Usuários como alternativa à digitação — as duas formas escrevem no mesmo campo, que segue editável. Gera 16 caracteres com `crypto.getRandomValues` e amostragem por rejeição (`Math.random()` não é criptograficamente seguro, e `% max` sobre 2³² enviesaria os primeiros valores). Garante um caractere de cada um dos 4 tipos, embaralha com Fisher-Yates e revalida contra a política antes de devolver. O alfabeto exclui `0 O 1 l I` para evitar erro de transcrição. Não foi exposto em "Alterar senha" (troca pelo próprio usuário): ali uma senha gerada e não guardada tranca o dono fora da conta, sem admin no caminho.
- **Troca de senha pelo próprio usuário** (`POST /auth/change-password`): exige a senha atual mesmo com a sessão autenticada, para que um token roubado não vire posse permanente da conta. Antes disso, só um ADMIN trocava senhas — o que obrigava o usuário a entregar a credencial a outra pessoa.
- **Reautenticação para redefinir senha de ADMIN** (`PUT /users/:id` com `current_password`): sem isso, um administrador assumia a conta de outro em silêncio e passava a agir na auditoria com o nome dele — escalada lateral entre admins.

### Proteção contra força bruta no login

Implementada em `backend/src/utils/loginThrottle.ts`, combinando **contagem de
tentativas** (rate limiting) com **bloqueio temporário progressivo** (account lockout).

**Dois eixos independentes** — qualquer um deles estourando já barra a tentativa:

| Eixo | O que contém | Limite padrão |
|---|---|---|
| `ACCOUNT` (e-mail digitado) | martelar a senha de um usuário específico | `LOGIN_THROTTLE_MAX_ATTEMPTS` = 3 falhas / 60s |
| `IP` (endereço de origem) | varrer muitas contas a partir do mesmo lugar | `LOGIN_THROTTLE_IP_MAX_ATTEMPTS` = 15 falhas / 60s |

O limite por IP é **separado e maior de propósito**. Num escritório várias pessoas
saem pelo mesmo IP (NAT); aplicar o limite da conta também ao IP faria três erros de
senha de três pessoas diferentes derrubarem o login do prédio inteiro.

#### Backoff exponencial

A duração do bloqueio cresce a cada reincidência (`LOGIN_THROTTLE_BLOCK_STEPS`,
padrão `60,300,900,3600,86400`):

| Bloqueio | Duração |
|---|---|
| 1º | 1 minuto |
| 2º | 5 minutos |
| 3º | 15 minutos |
| 4º | 1 hora |
| 5º em diante | 24 horas (o último degrau se repete) |

**O nível sobrevive ao fim do bloqueio** — é o ponto central do desenho. Se zerasse
junto, o backoff seria decorativo: bastaria esperar o minuto passar para recomeçar
sempre na punição mínima. O nível só volta a zero em **login bem-sucedido** ou após
`LOGIN_THROTTLE_LEVEL_RESET_SECONDS` (padrão 24 h) **sem nenhuma tentativa falha**. O
corte usa a última *falha*, não o fim do bloqueio: quem erra de novo no dia seguinte
continua reincidente.

O efeito prático é a assimetria desejada: errar a senha de verdade custa 1 minuto;
insistir é que fica caro.

**Bloqueio sem prazo.** Com `LOGIN_THROTTLE_MANUAL_UNLOCK=true`, o último degrau perde
a validade (`blocked_until` fica nulo, `requires_manual_unlock` vira `true`) e a
resposta sai **sem `Retry-After`** — informar um prazo inventado faria o cliente tentar
de novo à toa. O caminho de volta é **redefinir a senha**: pelo administrador em
`PUT /users/:id` ou pelo próprio usuário em `POST /auth/change-password`. Os dois
chamam `unlockAccount()` e limpam o contador. Sem esse caminho a conta ficaria presa
sem saída pela aplicação.

#### Comportamento da resposta

- Durante o bloqueio, **nem a senha correta entra**: `assertNotBlocked` roda **antes** da verificação da credencial.
- Resposta `429 Too Many Requests`, com `Retry-After` e o tempo restante na mensagem.
- A mensagem **não informa o nível nem qual eixo bloqueou** — dizer "3º bloqueio" daria ao atacante um retorno sobre o próprio progresso.
- Um login bem-sucedido zera contador **e** nível daquela conta e daquele IP; os demais alvos seguem intactos.

#### Mensagens genéricas e tempo de resposta

E-mail inexistente, senha errada e **conta inativa** devolvem exatamente a mesma
resposta: `Usuario ou senha invalidos.` A mensagem de conta inativa era específica e,
com isso, confirmava que aquele e-mail existia. O motivo real continua na auditoria,
onde só o administrador lê.

O **tempo** também é equalizado: quando o e-mail não existe, a API compara a senha
contra um hash descartável (`DUMMY_HASH`), para a demora não denunciar quais contas
existem.

#### Condição de corrida

O incremento é atômico: `registerFailure` roda dentro de `prisma.$transaction` com
`pg_advisory_xact_lock(hashtext('<scope>:<key>'))`. Tentativas paralelas contra o mesmo
alvo são serializadas, então nenhuma falha é "perdida" por duas requisições lendo o
mesmo contador ao mesmo tempo.

#### Registro

Cada bloqueio vira um evento `LOGIN_BLOCKED` na auditoria, com conta, IP e horário.
**A senha nunca é registrada**, em nenhuma hipótese.

> **Ainda em aberto:** `POST /auth/change-password` não tem limite de tentativas. O
> risco é menor (exige sessão autenticada válida), mas a senha atual ali também é
> adivinhável por repetição.

---

## 6. Segurança do embed (ocultação do link do Power BI)

Para que o link público do Power BI (`?r=...`) **não** fique exposto na interface:

1. A resposta do viewer (`/viewer/contracts/:id/iframes`) **omite** `power_bi_url` e envia, no lugar, um **`embed_token`** curto (validade ~1h, assinado, específico do painel).
2. O `<iframe>` do frontend aponta para uma rota da própria API:
   `GET /api/viewer/iframes/:id/embed?t=<embed_token>`.
3. Essa rota é **pública** (registrada antes do `authenticate`), pois um `<iframe>` do navegador não envia o header `Authorization`. Ela valida o `embed_token`, confere que corresponde ao painel e **redireciona (302)** para a URL real.

**O que isso protege:**
- A URL real **não** aparece no JSON da API nem no atributo `src` do iframe.
- O token de embed só é emitido após validar o acesso da conta (Camadas 2 e 4).

**Limitação conhecida (Power BI "Publicar na web"):**
A URL real ainda aparece no header **`Location`** do redirect (visível na aba
Network do DevTools). Não é possível ocultá-la 100% com proxy, porque o
"Publicar na web" é um app cliente que lê o token da própria URL para renderizar.
Para ocultação completa **e** renderização, use **Power BI Embedded** ([seção 12](#12-evolução-recomendada-power-bi-embedded)).

**Confinamento do iframe (frontend).** Os `<iframe>` que renderizam painéis usam:

- `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads"` — sem sandbox, o conteúdo de terceiros pode navegar a janela principal (redirecionar o usuário para fora do sistema) e abrir diálogos nativos. `allow-same-origin` é necessário porque o Power BI usa storage e cookies próprios, e é seguro aqui porque o documento final é `app.powerbi.com`, uma origem **diferente** da aplicação — portanto não alcança o DOM do sistema.
- `referrerPolicy="no-referrer"` — o `embed_token` viaja na **query string**; sem isso a URL que o contém seria enviada a terceiros no cabeçalho `Referer`.

> Se algum relatório deixar de renderizar, o `sandbox` é o primeiro suspeito: verifique no console qual permissão foi bloqueada antes de removê-lo por inteiro.

Artefatos: `backend/src/utils/embed.ts` (assina/valida token), `viewer.routes.ts`
(rota de embed e emissão do token), `frontend/src/pages/ViewerPage.tsx` e
`IframesPage.tsx` (atributos de confinamento).

---

## 7. Auditoria (logs)

Toda ação relevante é registrada em `audit_logs` via `backend/src/utils/audit.ts`.
O registro nunca quebra a requisição principal (erros são apenas logados).

**Ações registradas (`action`):**

| Categoria | Ações |
|---|---|
| Autenticação | `LOGIN`, `LOGIN_FAILED`, `LOGIN_BLOCKED` (bloqueio por força bruta), `LOGOUT` |
| Senhas | `PASSWORD_CHANGE` (pelo próprio usuário), `PASSWORD_RESET` (por um ADMIN) |
| Navegação | `PAGE_VIEW` (tela acessada), `IFRAME_VIEW` (painel aberto no viewer) |
| Usuários | `USER_CREATE`, `USER_UPDATE`, `USER_DELETE`, `USER_CONTRACTS`, `USER_SCREENS`, `USER_IFRAMES` |
| Contratos | `CONTRACT_CREATE`, `CONTRACT_UPDATE`, `CONTRACT_DELETE` |
| Iframes | `IFRAME_CREATE`, `IFRAME_UPDATE`, `IFRAME_DELETE` |
| Manutenção | `AUDIT_PURGE` (expurgo automático por retenção) |

**Consulta:** tela **Logs** (só ADMIN), com filtros por ação, usuário, texto livre e
intervalo de datas, além de paginação. Cada `PAGE_VIEW` é gravado pelo frontend a
cada troca de rota (com de-duplicação).

### Retenção (`backend/src/utils/auditRetention.ts`)

Cada linha guarda `ip_address` e `user_agent` — dado pessoal. Mantê-los indefinidamente
amplia o estrago de um vazamento do banco sem benefício operacional e contraria o
princípio da LGPD de não reter além da finalidade. Há também um motivo prático: o
`PAGE_VIEW` registra cada navegação de cada usuário, então a tabela cresce sem limite.

`purgeExpiredAuditLogs()` apaga o que for mais antigo que `AUDIT_LOG_RETENTION_DAYS`
(padrão 365; `0` desliga). É agendado em `server.ts`: roda no boot e a cada 24 h, com
`timer.unref()` para não segurar o encerramento do processo. O `deleteMany` usa o índice
`audit_logs(created_at)`, então não varre a tabela inteira.

**A mesma data de corte vale para `access_sessions` e `login_throttle`.** As duas
tabelas também guardam `ip_address`, isto é, dado pessoal: deixar as sessões fora do
expurgo esvaziaria a regra — bastaria olhar a outra tabela para reconstruir de onde
cada conta acessou. Em `login_throttle` só saem as linhas **vencidas** (sem bloqueio
ativo); um contador que já passou da janela e do bloqueio não serve para mais nada.
Apagar `access_sessions` leva `session_contract_usage` junto, em cascata.

O expurgo é idempotente — se duas instâncias da API rodarem juntas, a segunda
simplesmente não encontra nada. E ele registra a si mesmo como `AUDIT_PURGE`: sem isso,
um buraco no histórico seria indistinguível de adulteração.

---

## 8. Monitoramento de uso (medição de tempo)

Tela **Monitoramento** (`/monitoramento`, só ADMIN e DESENVOLVEDOR), alimentada por
`GET /api/monitoring/overview`.

### Por que não dá para medir tempo por LOGIN → LOGOUT

O pareamento `LOGIN` → `LOGOUT` parece a medida óbvia, mas **depende de o usuário
clicar em sair**. Nos dados reais deste sistema, cerca de **90% das sessões não tinham
`LOGOUT`**: as pessoas fecham a aba. Isso enviesa a métrica em duas direções ao mesmo
tempo — sessões sem saída viram tempo desconhecido, e sessões com saída tardia viram
tempo inflado.

A medição atual não depende de **nenhum evento de saída**.

### Como o heartbeat funciona

`backend/src/utils/accessSession.ts` + `frontend/src/lib/heartbeat.ts`.

A aba envia um sinal a cada `HEARTBEAT_SECONDS` (30 s) **enquanto estiver visível**
(`document.visibilityState === 'visible'`). Cada sinal apenas adianta o `last_seen_at`
da sessão aberta daquela conta. **Duração = `last_seen_at − started_at`.**

| Constante | Valor | Papel |
|---|---|---|
| `HEARTBEAT_SECONDS` | 30 s | intervalo entre sinais (combinado com o front) |
| `SESSION_GAP_SECONDS` | 5 min | silêncio a partir do qual o próximo sinal abre uma sessão **nova** |
| `MAX_SESSION_SECONDS` | 12 h | teto de duração (o JWT vale 8 h; nada acima disso é sessão real) |
| `MAX_ATTRIBUTABLE_GAP_SECONDS` | 60 s | maior intervalo entre dois sinais que ainda conta como tempo de tela |

Três propriedades vêm de graça nesse desenho:

1. **Não existe sessão "aberta para sempre".** Fechou a aba, travou o navegador, hibernou a máquina: o sinal para e a duração congela.
2. **Várias abas não contam em dobro.** A sessão é identificada pela **conta**, não pela aba — três abas abertas apenas renovam o mesmo `last_seen_at`. Se fosse por aba, quem trabalha com abas paralelas apareceria com o triplo do tempo.
3. **Tempo ocioso em segundo plano não entra**, porque o front só sinaliza com a aba visível.

`SESSION_GAP_SECONDS` precisa ser maior que o intervalo com folga (para que uma aba
lenta ou um pico de rede não parta a sessão em duas) e menor que um intervalo em que a
pessoa claramente saiu e voltou.

### O que o heartbeat NÃO inventa

`MAX_ATTRIBUTABLE_GAP_SECONDS` é o limite da honestidade da medida: o heartbeat só
atesta o que viu. Se dois sinais chegaram com 30 s de diferença, aqueles 30 s
existiram. Um intervalo **muito maior** significa que a aba ficou escondida ou a
máquina dormiu — nesse caso o tempo **não é atribuído**, em vez de ser chutado. Dois
intervalos de folga cobrem um sinal perdido por rede ruim sem inventar tempo.

### Tempo por contrato

Cada sinal soma o intervalo desde o sinal anterior em `session_contract_usage`, no
contrato em que a aba **estava durante** o intervalo (`last_contract_id`, o contrato do
sinal anterior). O front deduz o contrato de `/paineis/<uuid>` em
`window.location.pathname`.

### Atomicidade

`recordHeartbeat()` roda inteiro dentro de `prisma.$transaction` com
`pg_advisory_xact_lock(hashtext(userId))`. Sem isso, o `find-or-create` da sessão não é
atômico e dois sinais simultâneos criam **duas** sessões para a mesma conta — foi um bug
real, disparado pelo duplo render do `React.StrictMode` e reproduzível com sinais
paralelos. Com o lock, 10 sinais em paralelo resultam em 1 sessão.

### Blocos da tela

`GET /api/monitoring/overview` devolve **tudo numa resposta**: a tela carrega de uma vez
e várias métricas saem do **mesmo** conjunto de linhas de `audit_logs` — buscar uma vez
e agregar em memória evita repetir a consulta mais pesada do sistema cinco vezes.

| Campo | Conteúdo |
|---|---|
| `summary` | sessões, logins, contas ativas, `iframe_views`, falhas de login, tempo total, média por sessão e `online_now` |
| `timeline` | sessões e visualizações por dia ou semana |
| `top_iframes` | painéis mais acessados, com visualizações e espectadores distintos |
| `never_accessed` | painéis sem nenhuma visualização no período |
| `by_user` | por conta: sessões, tempo medido, visualizações, último acesso, se está online |
| `last_accesses` | últimos acessos (tabela paginada) |
| `by_contract` | por contrato: visualizações, **tempo medido** e visitantes distintos |
| `heatmap` | dia da semana × hora do dia |
| `login_failures` | falhas de login agrupadas por conta |
| `inactive_users` | contas sem login há `inactive_days` (padrão 30) |

`online_now` conta contas com sinal recebido dentro de `SESSION_GAP_SECONDS`
(`isOnline`) — é "quem está no sistema agora", não "quem logou hoje".

### Teto de leitura

`MAX_ROWS = 60_000` limita as linhas lidas de `audit_logs` numa consulta. `PAGE_VIEW` e
`IFRAME_VIEW` crescem rápido; sem teto, um período largo carregaria a tabela inteira na
memória. Atingido o teto, a resposta traz **`truncated: true`** para a tela poder avisar
que o período é grande demais, em vez de exibir um número silenciosamente incompleto.

### Fontes de dado que precisaram ser criadas

A tela não era possível com o que havia registrado. Três lacunas foram preenchidas
antes: a ação `IFRAME_VIEW` (nenhum registro dizia **qual painel** foi aberto), o `uid`
no token de embed (a rota de embed é pública e não sabia **quem** abriu) e a duração
medida (`access_sessions`).

### Gráficos

`frontend/src/lib/charts.ts` concentra a paleta e a formatação. A paleta categórica
(`#1d66f0`, `#ea580c`, `#0d9488`, `#9333ea`) foi **validada para daltonismo** —
separação mínima em deuteranopia/protanopia, piso de contraste e de croma —, não
escolhida a olho. As tabelas usam `components/ui/PaginatedTable.tsx`, com paginação em
memória de 10 linhas e controles ocultos quando não há o que paginar.

---

## 9. Referência da API

Prefixo `/api`. Todas as rotas exigem `Authorization: Bearer <token>`, exceto onde
indicado como **público**. Erros seguem o formato:
`{ "message": "...", "errors": [{ "field": "...", "message": "..." }] }`.

`POST /auth/login` pode responder **429** quando a conta ou o IP está bloqueado por
tentativas, com o cabeçalho `Retry-After` (ausente quando o bloqueio não tem prazo) —
ver [Proteção contra força bruta](#proteção-contra-força-bruta-no-login).

### Autenticação
| Método | Rota | Acesso |
|---|---|---|
| POST | `/auth/login` | **público** |
| POST | `/auth/logout` | autenticado (registra auditoria) |
| POST | `/auth/register` | ADMIN |
| POST | `/auth/change-password` | autenticado — body `{ "current_password", "new_password" }`; 204 em caso de sucesso |
| GET | `/auth/me` | autenticado |

### Usuários (ADMIN e DESENVOLVEDOR)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/users` | lista |
| GET | `/users/:id` | detalhe |
| POST | `/users` | cria (telas padrão pelo perfil) |
| PUT | `/users/:id` | atualiza. Redefinir a senha de uma conta **ADMIN** exige `current_password` (senha de quem executa) — 403 sem ela, 401 se estiver errada |
| DELETE | `/users/:id` | exclui (preserva contratos) |
| PUT | `/users/:id/contracts` | body `{ "contract_ids": [] }` |
| PUT | `/users/:id/screens` | body `{ "screens": [] }` — só telas configuráveis; rejeita ADMIN |
| GET | `/users/:id/iframes` | retorna `{ "iframe_ids": [] }` concedidos |
| PUT | `/users/:id/iframes` | body `{ "iframe_ids": [] }` — só VISUALIZADOR |

### Contratos
| Método | Rota | Acesso |
|---|---|---|
| GET | `/contracts` (`?status=`, `?search=`) | autenticado (escopo por perfil) |
| GET | `/contracts/:id` | autenticado com acesso |
| POST | `/contracts` | ADMIN, DESENVOLVEDOR, GESTOR |
| PUT | `/contracts/:id` | ADMIN, DESENVOLVEDOR, GESTOR (só associados) |
| DELETE | `/contracts/:id` | ADMIN, DESENVOLVEDOR |
| GET | `/contracts/:id/iframes` | autenticado com acesso |

**Contadores por perfil.** Os campos `iframes_count` e `users_count` do DTO de contrato
são montados conforme quem pergunta, para que o número exibido não revele mais do que a
conta enxerga:

| Perfil | `iframes_count` | `users_count` |
|---|---|---|
| ADMIN / DESENVOLVEDOR | todos os painéis | presente |
| GESTOR | todos os painéis | **omitido** — quantas contas usam o contrato é informação de gestão de acesso |
| VISUALIZADOR | só os painéis **ativos e concedidos** a ele (Camada 4) | **omitido** |

Antes disso, um VISUALIZADOR via "8 painéis" num contrato em que só tinha acesso a 2.
Os campos são **omitidos**, não zerados: `serializeContract` só inclui cada contador
quando a rota realmente o selecionou, para não devolver um `0` enganoso.

### Iframes
| Método | Rota | Acesso |
|---|---|---|
| GET | `/iframes` (`?contract_id=`, `?is_active=`, `?search=`) | autenticado (escopo por perfil) |
| GET | `/iframes/:id` | autenticado com acesso |
| POST | `/iframes` | ADMIN, DESENVOLVEDOR, GESTOR |
| PUT | `/iframes/:id` | ADMIN, DESENVOLVEDOR, GESTOR |
| DELETE | `/iframes/:id` | ADMIN, DESENVOLVEDOR, GESTOR |

### Viewer (tela "Paineis")
| Método | Rota | Acesso |
|---|---|---|
| GET | `/viewer/contracts` | autenticado (VISUALIZADOR: por concessão) |
| GET | `/viewer/contracts/:id/iframes` | autenticado (retorna `embed_token`, sem `power_bi_url`) |
| GET | `/viewer/iframes/:id/embed?t=<token>` | **público** (token de embed) → 302 para o Power BI |

### Dashboard
| Método | Rota | Acesso |
|---|---|---|
| GET | `/dashboard/summary` | autenticado (contadores por escopo) |

### Logs
| Método | Rota | Acesso |
|---|---|---|
| POST | `/logs/page-view` | autenticado (qualquer perfil) — body `{ "path": "", "label": "" }` |
| POST | `/logs/heartbeat` | autenticado — body `{ "contract_id"? }`; sinal de sessão a cada 30 s (ver [seção 8](#8-monitoramento-de-uso-medição-de-tempo)) |
| GET | `/logs` (`?action=`, `?user_id=`, `?search=`, `?from=`, `?to=`, `?page=`, `?page_size=`) | ADMIN |

### Monitoramento
| Método | Rota | Acesso |
|---|---|---|
| GET | `/monitoring/overview` (`?from=`, `?to=`, `?granularity=day\|week`, `?user_id=`, `?inactive_days=`) | ADMIN e DESENVOLVEDOR |

`from`/`to` no formato `yyyy-mm-dd`; o padrão é os **últimos 30 dias**. Todas as
métricas vêm na mesma resposta — ver [seção 8](#8-monitoramento-de-uso-medição-de-tempo).

### Health
| Método | Rota | Acesso |
|---|---|---|
| GET | `/health` | **público** |

---

## 10. Frontend: páginas, rotas e telas

| Rota | Página | Chave de tela | Quem vê |
|---|---|---|---|
| `/login` | Login | — | público |
| `/` | Dashboard | `dashboard` | quem tiver a tela liberada |
| `/users` | Usuários | `users` | ADMIN |
| `/permissions` | Permissões (telas + acesso aos painéis) | `permissions` | ADMIN |
| `/contracts` | Contratos | `contracts` | quem tiver a tela liberada |
| `/iframes` | Iframes | `iframes` | quem tiver a tela liberada |
| `/paineis`, `/paineis/:contractId` | Paineis (viewer) | `viewer` | quem tiver a tela liberada |
| `/logs` | Logs de auditoria | `logs` | ADMIN |
| `/monitoramento` | Monitoramento de uso | `monitoring` | ADMIN e DESENVOLVEDOR |

> **Nota:** a rota é `/paineis`, mas a **chave de tela** e as rotas da **API**
> continuam `viewer` / `/api/viewer/...` (compatibilidade com permissões salvas).

- **Menu**: montado a partir de `allowed_screens` da conta (`Layout.tsx`).
- **Guarda de rota**: `ProtectedRoute` bloqueia acesso direto por URL a telas não liberadas e redireciona para a primeira tela permitida.
- **Sessão**: token JWT em `localStorage`; qualquer `401` derruba a sessão.
- **Heartbeat**: enquanto há sessão ativa e a aba está visível, o front envia `POST /logs/heartbeat` a cada 30 s (`lib/heartbeat.ts`).
- **Carregamento**: a tela de Monitoramento entra por `lazy()`, em chunk separado — ela puxa o Recharts, que não deve pesar no bundle de quem nunca a abre.

---

## 11. Migrações de banco

Histórico em `backend/prisma/migrations/`:

| Migração | Conteúdo |
|---|---|
| `20260902121735_init` | usuários, contratos, iframes, associações |
| `20260902133323_add_audit_log` | tabela `audit_logs` |
| `20260902135527_add_user_allowed_screens` | coluna `allowed_screens` em `users` |
| `20260902145353_add_user_iframe_grants` | tabela `user_iframes` (acesso por dashboard) |
| `20260909120000_add_desenvolvedor_role` | valor `DESENVOLVEDOR` no enum `Role` |
| `20261014140000_add_access_sessions` | tabela `access_sessions` (medição por heartbeat) |
| `20261014180000_add_contract_usage` | tabela `session_contract_usage` (tempo por contrato) |
| `20261015100000_add_login_throttle` | enum `ThrottleScope` e tabela `login_throttle` |
| `20261015140000_login_throttle_backoff` | colunas `block_level`, `requires_manual_unlock`, `last_failure_at` |

- Desenvolvimento: `npx prisma migrate dev`
- Produção: `npx prisma migrate deploy`

> Quando `allowed_screens` foi adicionada, os usuários não-admin **existentes** ficaram
> com as quatro telas configuráveis (`dashboard`, `contracts`, `iframes`, `viewer`), e
> continuam assim — a migração não é reaplicada. Contas criadas a partir de agora
> recebem apenas `viewer` (ver [Camada 3](#camada-3--permissões-de-tela-por-conta-allowed_screens--menu-frontend)).
> ADMIN é sempre tratado como "todas as telas".

---

## 12. Evolução recomendada (Power BI Embedded)

O modelo atual usa **"Publicar na web"** — relatórios **públicos** (qualquer pessoa
com o link acessa, sem autenticação). Não use com dados confidenciais.

Para segurança real (acesso autenticado + link nunca exposto), migre para
**Power BI Embedded ("App owns data")** com service principal (Azure AD):

1. Registrar app no Azure AD (service principal) e habilitá-lo no portal de admin do Power BI.
2. Criar workspace, adicionar o service principal e publicar o relatório.
3. Provisionar capacidade (Power BI Embedded SKU A / Fabric SKU F) para produção.
4. Backend: autenticar como service principal, gerar **embed token** curto via API do Power BI (`GenerateToken`) após validar o acesso da conta — reaproveitando as Camadas 2 e 4.
5. Frontend: renderizar com a lib `powerbi-client` (em vez do `<iframe>`).
6. Opcional: **Row-Level Security (RLS)** para filtrar dados por conta dentro do mesmo relatório.

Isso encaixa na arquitetura atual: muda **o que** a rota de embed retorna
(token + embedUrl, em vez de um redirect) e o **componente** de renderização.
