# NutriMed — Board de Especialistas de IA Humanizados — Product Requirements Document (PRD)

> **Tipo:** PRD de Produto (núcleo da plataforma NutriMed)
> **Autor:** Morgan (Product Manager / Strategist) · **Data:** 2026-06-08 · **Status:** Draft v1.0
> **Comando:** `*create-prd` · **Template:** prd-template-v2
> **Handoff de origem:** Atlas (@analyst) → Morgan (@pm)
> **Fontes-base (rastreabilidade — Article IV / No Invention):**
> - `[MR]` `docs/market-research.md` — pesquisa de mercado (TAM/SAM/SOM, concorrência, Porter, pricing)
> - `[PB]` `docs/personas-board.md` — design das 3 personas de IA e dinâmica do board
> - `[KB]` `docs/personas-knowledge-base-seed.md` — base-semente, escopos e gatilhos proativos
> - `[UX]` `docs/board-ux-design.md` — UX (Board Ativo + painel lateral, hierarquia, guarda-corpos)
> - `[ASSUMPTION]` = suposição introduzida neste PRD, a validar (não derivada das fontes)

---

## 1. Goals and Background Context

### Goals

- Validar a hipótese central de que nutrólogos de clínicas premium adotam consistentemente um **board de 3 especialistas de IA humanizados** que acompanha a consulta ao vivo e sugere proativamente. `[MR]`
- Entregar **segurança clínica e a sensação de "estar acompanhado"** durante condutas cardiometabólicas complexas (GLP-1, hipertensão, dislipidemia, tireoide), reduzindo a ansiedade do médico de decidir sozinho. `[MR]` `[PB]`
- Construir e proteger o **fosso competitivo real**: a base de conhecimento clínica curada por especialidade (diretrizes ABRAN/SBEM/SBC) — o avatar é encantamento, a base é o fosso. `[MR]` `[KB]`
- Posicionar o produto como **apoio à decisão** ("a IA assiste, o nutrólogo decide"), nunca como diagnóstico autônomo, sustentando postura regulatória defensável perante CFM/LGPD. `[MR]` `[PB]`
- Provar valor e "uau" de demo no **nicho premium** (emagrecimento/obesidade/longevidade) — early adopters com alta disposição a pagar — antes de escalar para o SAM. `[MR]`
- Manter custo unitário controlado no MVP usando **texto + vídeo pré-renderizado por IA** (sem voz/TTS, sem avatar em tempo real). `[PB]` `[UX]`

### Background Context

A NutriMed propõe um produto que hoje não existe no mercado em sua forma completa: um **board virtual de 3 especialistas de IA humanizados** — Dr. Aurélio Bastos (nutrólogo/anfitrião), Dr. Paulo Tavares (cardiologista) e Dra. Yara Nakamura (endocrinologista) — que acompanham a consulta do nutrólogo ao vivo via transcrição em tempo real, sugerindo perguntas e sinalizando pontos importantes de forma proativa. A pesquisa de mercado `[MR]` estabeleceu que o mercado já resolveu separadamente cada bloco (transcrição clínica ambient, copiloto consultivo, avatares de vídeo, voz com persona), mas **ninguém integrou tudo em personas médicas humanizadas, persistentes e verticais para a nutrologia brasileira**. Esse é um espaço em branco defensável — desde que o diferencial seja a profundidade clínica curada, não o avatar.

O timing é favorável: a explosão da medicina de emagrecimento/metabólica (GLP-1) elevou a demanda por nutrologia e seu cruzamento com risco cardiovascular e endócrino, exatamente o eixo cardiometabólico do board. A estratégia de entrada é por **nicho premium** (clínicas de emagrecimento/longevidade), com pricing de assinatura individual acima do concorrente mais próximo (Nova Health, R$ 149/mês), usando preço como sinal de profundidade. O MVP é deliberadamente enxuto — **apenas texto, board sempre ativo, vídeo silencioso gerado por IA** — para validar o comportamento de uso e a percepção de valor antes de investir em voz, avatar interativo e na expansão da base de conhecimento. `[MR]` `[PB]` `[UX]`

### Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-06-08 | v1.0 | Criação inicial do PRD do produto NutriMed (board de especialistas de IA), consolidando market-research, personas-board, knowledge-base-seed e board-ux-design. | Morgan (@pm) |

---

## 2. Problem & Opportunity

### Problem Statement

O nutrólogo — especialmente em clínicas de emagrecimento/longevidade premium — enfrenta três dores simultâneas durante a consulta `[MR]`:

1. **Insegurança em condutas cardiometabólicas complexas:** interações medicamentosas, segurança cardiovascular de GLP-1/simpaticomiméticos/termogênicos, reposições hormonais e platôs de emagrecimento exigem raciocínio cruzado de cardio + endo que o nutrólogo nem sempre domina com confiança.
2. **Solidão na decisão:** não há um colega especialista presente para validar a conduta em tempo real; a alternativa é interromper o fluxo (WhatsApp a um colega, UpToDate, Google/ChatGPT) ou decidir sozinho com ansiedade.
3. **Sobrecarga de documentação:** transcrever e estruturar a consulta consome tempo (~2h/dia de carga administrativa, segundo a pesquisa) e contribui para burnout.

As soluções existentes resolvem isso de forma **fragmentada e genérica**: a transcrição/copiloto (Nova Health, Abridge) virou commodity e é raso/genérico; os avatares e a voz com persona são infraestrutura, não produto clínico. Nenhuma solução entrega **personas médicas persistentes, humanizadas, verticais e proativas** atuando como um board ao vivo. `[MR]`

### Opportunity

| Métrica | Valor (estimativa de ordem de grandeza — validar) | Fonte |
|---------|---------------------------------------------------|-------|
| TAM (médicos das 3 especialidades × R$ 3.600/ano) | ~R$ 86M/ano (~24.000 médicos) | `[MR]` |
| SAM (nutrólogos ativos com perfil digital) | ~R$ 36M/ano (~10.000 nutrólogos) | `[MR]` |
| SOM (nicho premium captável em 24 meses) | ~R$ 270k–900k ARR (~75–250 pagantes) | `[MR]` |

> **Leitura estratégica `[MR]`:** mercado de **profundidade, não de escala bruta** — ticket alto, baixa concorrência direta no formato proposto, alta disposição a pagar no nicho premium. Coerente com a estratégia de nicho e com um MVP enxuto que prioriza encantamento + profundidade clínica.

---

## 3. User Personas (Cliente)

> **Nota importante:** As **3 personas de IA** (Dr. Aurélio, Dr. Paulo, Dra. Yara) **NÃO** são usuários — são **features/funcionalidades** do produto (ver Seção 5 e Requisitos). As personas de usuário abaixo são os **clientes humanos** que compram e usam a NutriMed.

### Persona Primária (MVP) — Dra. Helena, Nutróloga de Clínica Premium

| Atributo | Definição | Fonte |
|----------|-----------|-------|
| **Perfil** | Nutróloga em clínica privada de emagrecimento/obesidade/longevidade ou medicina integrativa, clientela de alto padrão. | `[MR]` Segment 1 |
| **Maturidade digital** | Alta — investe em diferenciação de experiência e tecnologia. | `[MR]` |
| **Casos típicos** | Cardiometabólicos complexos: GLP-1, hipertensão, dislipidemia, tireoide, platôs de emagrecimento. | `[MR]` |
| **Dores** | Insegurança em condutas que cruzam cardio/endo; medo de interação medicamentosa; falta de tempo para documentação; quer impressionar e reter pacientes premium. | `[MR]` |
| **Jobs (funcional)** | Documentar a consulta; tirar dúvidas técnicas ao vivo; checar interações/doses cardiometabólicas; receber direcionamento de conduta; obter "segunda opinião" estruturada. | `[MR]` JTBD |
| **Jobs (emocional)** | Sentir segurança ao conduzir casos complexos; reduzir a ansiedade de decidir sozinha; sentir-se acompanhada por "colegas". | `[MR]` JTBD |
| **Jobs (social)** | Ser percebida pelo paciente como médica moderna e completa; ser vista pelos pares como inovadora. | `[MR]` JTBD |
| **Processo de compra** | Decisão individual e rápida; sensível a demonstração ("uau"); indicação por pares. | `[MR]` |
| **Disposição a pagar** | **Alta** — R$ 300–600/mês aceitável se entregar segurança + experiência premium. | `[MR]` |

### Persona Secundária (Expansão SAM — fora do MVP) — Dr. Carlos, Nutrólogo Generalista

| Atributo | Definição | Fonte |
|----------|-----------|-------|
| **Perfil** | Nutrólogo autônomo de consultório, atendimento misto (convênio/particular). | `[MR]` Segment 2 |
| **Características** | Mais sensível a preço, adoção mais lenta, valoriza economia de tempo. | `[MR]` |
| **Disposição a pagar** | **Média** — R$ 150–300/mês; quer trial gratuito. | `[MR]` |

> **Segment 3 (Clínicas/B2B)** é expansão futura, explicitamente **fora do escopo deste PRD**. `[MR]`

---

## 4. The AI Board (Feature Spec — não são usuários)

O board é o coração do produto. As 3 personas são **features humanizadas e proativas**. `[PB]`

| Papel | Persona | Arquétipo | Função no board | Escopo clínico (semente) |
|-------|---------|-----------|-----------------|--------------------------|
| 🩺 Nutrólogo (anfitrião) | **Dr. Aurélio Bastos** | O Veterano | Ancora, modera, integra e fecha a recomendação | Terapia nutricional, composição corporal, deficiências, visão integral, condução do caso (ABRAN) `[KB]` |
| ❤️ Cardiologista | **Dr. Paulo Tavares** | O Estrategista | Avalia e protege o risco cardiovascular — destrava com segurança | Risco CV, hipertensão, dislipidemia, segurança CV de fármacos (GLP-1/simpaticomiméticos/termogênicos), cardiologia preventiva (SBC) `[KB]` |
| 🔬 Endocrinologista | **Dra. Yara Nakamura** | A Decifradora | Investiga o "porquê" metabólico/hormonal | Eixo tireoidiano, resistência insulínica, GLP-1 (mecanismo), reposições hormonais, diabetes, metabolismo (SBEM) `[KB]` |

### Dinâmica do board `[PB]`
- **Eixo de tensão saudável:** Yara (aprofundar) ↔ Aurélio (equilibrar/integrar) ↔ Paulo (agir com segurança).
- **Fluxo típico de rodada:** Aurélio abre → Yara investiga → Paulo avalia risco e oferece caminho seguro → Aurélio sintetiza e devolve a decisão ao nutrólogo.
- **Discordância é feature, não bug:** quando há divergência, o sistema expõe com transparência e Aurélio modera, marcando que a decisão é do médico.

### Comportamento no MVP `[PB]` `[KB]` `[UX]`
- **Ativação:** sempre ativos desde o início da transcrição (proativos, não "chamados").
- **Modalidade:** **apenas texto** no MVP (sem voz/TTS).
- **Vídeo:** gerado 100% por IA, presença silenciosa em loop (ouvindo / pensando / sinalizando).
- **Síntese:** Aurélio integra e fecha; a decisão final é sempre do nutrólogo.

---

## 5. MVP Scope (In / Out)

### IN — Escopo do MVP

1. **Transcrição da consulta ao vivo** (ambient, em tempo real, PT-BR). `[MR]` `[KB]`
2. **Board sempre ativo** com as 3 personas monitorando a transcrição e sugerindo proativamente. `[PB]` `[KB]`
3. **Contribuições por texto** das personas, classificadas em 4 tipos: ⚠️ ponto de atenção, 💡 sugestão de pergunta, 🔍 hipótese/insight, 📋 síntese. `[UX]`
4. **Vídeos pré-renderizados por IA** (3 estados por persona: ouvindo / pensando / sinalizando) como presença silenciosa. `[PB]` `[UX]`
5. **UX Board Ativo + painel lateral fixo** (3 vídeos pequenos + feed de sugestões cronológico inverso, ⚠️ fixa no topo). `[UX]`
6. **Guarda-corpos contra ruído:** score de relevância, rate limit por doutor, deduplicação/consolidação por Aurélio, surgimento em pausas, decaimento visual. `[UX]`
7. **Controles do nutrólogo:** silenciar doutor, expandir/perguntar (texto), dispensar (✓), fixar (📌), **Modo Foco** (silencia tudo exceto ⚠️). `[UX]`
8. **Síntese do board** ao final da rodada / sob demanda (Aurélio). `[PB]` `[KB]`
9. **Base de conhecimento-semente** por persona (escopos + fontes-semente + gatilhos proativos) — placeholder até a base curada. `[KB]`
10. **Disclaimers e postura "IA assiste, médico decide"** visíveis e consentimento de gravação. `[MR]` `[PB]`
11. **Documentação básica da consulta** (transcrição estruturada / nota clínica) — paridade mínima com o mercado, como facilitador de adoção. `[MR]` Opportunity 2 — *escopo mínimo, ver `[ASSUMPTION]` abaixo*.

### OUT — Fora do MVP (explícito)

1. **Voz / TTS** (conversa por voz com as personas) — pós-MVP. `[PB]`
2. **Avatar interativo em tempo real** (streaming, turn-taking) — pós-MVP. `[PB]` `[MR]`
3. **Base de conhecimento curada definitiva** (o fosso) — virá do usuário depois; MVP usa a semente. `[KB]` `[PB]`
4. **Modo "paciente-visível"** / experiência de marketing voltada ao paciente. `[MR]` Opportunity 3
5. **B2B / licenças de clínica (Segment 3)** e branding institucional. `[MR]`
6. **Integração com EHR/prontuário de terceiros.** `[ASSUMPTION]` (não citado nas fontes; mantido fora para não ampliar escopo)
7. **"Entrando no board" / estado "Falando"** dos vídeos (não há voz; todos já ativos). `[PB]`
8. **Calibração fina de limiar de relevância e rate limit** — depende de teste com médicos reais; MVP usa defaults a serem ajustados no piloto. `[UX]`

> `[ASSUMPTION]` O nível exato de profundidade da "documentação básica" (FR/SOAP automático completo vs. transcrição estruturada simples) não foi fechado nas fontes. **Suposição de produto:** no MVP entregar transcrição estruturada + nota clínica simples editável, deixando SOAP/template avançado para iteração. Validar com design partners.

---

## 6. Requirements

### Functional Requirements (FR)

- **FR1:** O sistema deve transcrever a consulta em tempo real, em português do Brasil, a partir do áudio captado durante o atendimento. `[MR]` `[KB]`
- **FR2:** As 3 personas (Aurélio, Paulo, Yara) devem ficar **ativas desde o início** da transcrição, monitorando-a continuamente, sem necessidade de serem invocadas. `[PB]` `[KB]`
- **FR3:** Cada persona deve **publicar contribuições em texto proativamente** quando um de seus gatilhos clínicos for detectado na transcrição (ver gatilhos por persona em `[KB]`). `[KB]`
- **FR4:** O Dr. Paulo deve emitir alerta de **segurança cardiovascular** ao detectar menção/prescrição de GLP-1, anfepramona, sibutramina, termogênicos, ou sinais como pressão alta/palpitação/dor no peito/falta de ar — sempre acompanhando o alerta com o "como fazer com segurança". `[KB]` `[PB]`
- **FR5:** A Dra. Yara deve levantar **hipótese hormonal/metabólica** (ex.: sugerir TSH/T4 livre) ao detectar cansaço, ganho de peso inexplicado, frio, queda de cabelo, ou platô de emagrecimento apesar de tratamento. `[KB]`
- **FR6:** O Dr. Aurélio deve **abrir** a rodada, organizar o raciocínio, e ao final **sintetizar** as contribuições de Yara e Paulo numa recomendação única, sempre devolvendo a decisão ao nutrólogo. `[KB]` `[PB]`
- **FR7:** Quando duas personas divergirem, o sistema deve **expor a divergência de forma transparente** (não escondê-la), com Aurélio moderando e marcando que a escolha é do médico. `[PB]`
- **FR8:** O sistema deve classificar cada contribuição em um de 4 tipos com ícone/cor distintos: ⚠️ ponto de atenção, 💡 sugestão de pergunta, 🔍 hipótese/insight, 📋 síntese. `[UX]`
- **FR9:** O painel lateral fixo deve exibir os **3 vídeos das personas** (gerados por IA, em loop) e um **feed de sugestões** em ordem cronológica inversa, com mensagens ⚠️ críticas fixadas no topo até serem resolvidas. `[UX]`
- **FR10:** O vídeo da persona que acabou de publicar deve mudar para o estado **"sinalizando"** por alguns segundos para puxar a atenção do médico; o estado default é **"ouvindo"** e há um estado **"pensando"** ao formular. `[UX]` `[PB]`
- **FR11:** O sistema deve **consolidar (deduplicar)** contribuições redundantes: se duas personas apontarem o mesmo ponto, Aurélio agrupa em uma só mensagem. `[UX]`
- **FR12:** Sugestões 💡/🔍 devem surgir preferencialmente em **pausas naturais** da fala; apenas ⚠️ críticos podem aparecer imediatamente. `[UX]`
- **FR13:** O nutrólogo deve poder **silenciar** um doutor pontualmente. `[UX]`
- **FR14:** O nutrólogo deve poder **expandir** uma sugestão e **perguntar mais** àquele doutor por texto. `[UX]`
- **FR15:** O nutrólogo deve poder **dispensar (✓)** e **fixar (📌)** sugestões individualmente. `[UX]`
- **FR16:** O sistema deve oferecer um **Modo Foco** que silencia todas as contribuições exceto ⚠️ críticas. `[UX]`
- **FR17:** O sistema deve gerar uma **documentação básica da consulta** (transcrição estruturada + nota clínica editável) a partir da transcrição. `[MR]` `[ASSUMPTION]` (profundidade a validar — ver Seção 5)
- **FR18:** O sistema deve permitir **gerar a síntese do board sob demanda**, além da síntese automática ao final da rodada. `[KB]`
- **FR19:** O sistema deve exibir **disclaimers de apoio à decisão** ("a IA assiste, o nutrólogo decide") de forma persistente e clara na interface. `[MR]` `[PB]`
- **FR20:** O sistema deve obter **consentimento de gravação** antes de iniciar a transcrição da consulta. `[MR]`
- **FR21:** Cada persona deve carregar seu **escopo de domínio e fontes-semente** definidos em `[KB]`, de forma que suas contribuições fiquem restritas à sua especialidade. `[KB]`

### Non-Functional Requirements (NFR)

- **NFR1 (Controle de ruído — relevância):** Uma persona só publica uma contribuição se um **score de relevância/confiança** ultrapassar um limiar configurável; palpites fracos não viram mensagem. `[UX]`
- **NFR2 (Controle de ruído — rate limit):** Deve haver **teto de contribuições por minuto por doutor** (ex.: 1–2), com fila de prioridade; ⚠️ críticos sempre furam a fila; redundância é descartada. `[UX]`
- **NFR3 (Controle de ruído — decaimento visual):** O destaque de uma sugestão deve **desvanecer após N segundos** para evitar acúmulo de ruído visual permanente. `[UX]`
- **NFR4 (Hierarquia visual de segurança):** O peso/cor visual de ⚠️ deve ser **sempre maior** que o de 💡/🔍 — segurança nunca compete visualmente com sugestão comum. `[UX]`
- **NFR5 (Latência de transcrição):** A transcrição em tempo real deve ter latência baixa o suficiente para que as contribuições proativas sejam úteis durante a consulta. `[MR]` `[ASSUMPTION]` (meta numérica a definir; sugestão: < 2–3s da fala ao texto)
- **NFR6 (Qualidade de vídeo / anti-uncanny-valley):** Os loops de vídeo devem priorizar planos estáveis, expressões sutis e loops curtos bem costurados, com **consistência visual** da mesma persona entre clipes (ponto crítico de qualidade). `[PB]`
- **NFR7 (Custo unitário):** A arquitetura deve manter o custo unitário controlado usando **vídeo pré-renderizado** (não streaming em tempo real) no MVP. `[PB]` `[MR]`
- **NFR8 (Modularidade de fornecedores):** A arquitetura deve ser **modular** quanto a fornecedores de LLM/STT (e futuramente TTS/avatar), permitindo troca de provedor para controlar custo e dependência (Supplier Power ALTO). `[MR]`
- **NFR9 (LGPD / dados sensíveis):** Dados sensíveis de saúde devem ser tratados com arquitetura rigorosa de privacidade, criptografia, controle de acesso e trilha de auditoria. `[MR]`
- **NFR10 (Postura regulatória CFM):** O produto deve operar explicitamente como **apoio à decisão do médico** — nunca diagnóstico autônomo — com trilha de auditoria das contribuições. `[MR]` `[PB]`
- **NFR11 (Idioma):** Toda a experiência clínica (transcrição, contribuições, síntese, voz das personas) deve ser em **português do Brasil**. `[PB]` `[MR]`
- **NFR12 (Confiabilidade da experiência de demo):** O fluxo deve sustentar uma **demonstração ao vivo impactante** ("uau") com profundidade clínica perceptível, pois a conversão depende disso. `[MR]`

---

## 7. User Interface Design Goals

### Overall UX Vision

A experiência deve transmitir a sensação de **"três colegas especialistas sêniores ao seu lado"** durante a consulta — presença máxima sem competir com o paciente. O **Board Ativo** entrega o encantamento; os guarda-corpos contra ruído e o Modo Foco protegem a consulta real. `[UX]` `[PB]`

### Key Interaction Paradigms

- **Painel lateral fixo** sempre visível: 3 vídeos das personas (loop por IA) no topo + feed de sugestões abaixo. `[UX]`
- **Feed cronológico inverso**, com ⚠️ críticos fixos no topo. `[UX]`
- **Vídeo reativo:** a persona que sugeriu muda para "sinalizando" para puxar o olhar. `[UX]`
- Contribuições acionáveis: expandir / dispensar / fixar / silenciar / Modo Foco. `[UX]`

### Core Screens and Views

- **Tela de Consulta (principal):** área principal (transcrição ao vivo / prontuário) + painel lateral do board. `[UX]`
- **Tela de Consentimento / Início de Gravação.** `[MR]` (FR20)
- **Tela de Síntese / Nota Clínica** (revisão e edição pós-consulta). `[ASSUMPTION]` (derivada de FR17)
- **Onboarding das personas** (apresentação de Aurélio/Paulo/Yara — nome/história). `[MR]` Customer Journey

### Accessibility

`[ASSUMPTION]` **WCAG AA** como meta-padrão (não especificado nas fontes). A definir com @ux-design-expert.

### Branding

`[ASSUMPTION]` Identidade visual a definir. Diretriz herdada: tom de **mentores sêniores**, sóbrio e confiável; hierarquia de cores onde ⚠️ (âmbar/vermelho) > 💡 (azul) / 🔍 (roxo) > 📋 (neutro). `[UX]`

### Target Device and Platforms

`[ASSUMPTION]` **Web Responsive** (desktop-first para uso em consultório). A confirmar; o layout de painel lateral fixo sugere tela ampla. `[UX]`

---

## 8. Technical Assumptions

> Pré-populado com base no preset ativo do projeto (`nextjs-react`) e nas restrições das fontes. Decisões finais cabem ao @architect.

- **Repository Structure:** `[ASSUMPTION]` Monorepo (alinhado ao preset e à modularidade de fornecedores).
- **Service Architecture:** `[ASSUMPTION]` Serverless/modular para isolar integrações de terceiros (LLM, STT, geração de vídeo) — coerente com NFR8 (modularidade) e NFR7 (custo). A decidir pelo @architect.
- **Testing Requirements:** `[ASSUMPTION]` Unit + Integration no MVP (integrações de terceiros são o risco principal).
- **Integrações de terceiros (constraints do @architect):**
  - **LLM** para o raciocínio das personas e classificação de contribuições. `[MR]`
  - **STT / transcrição** em tempo real PT-BR. `[MR]` `[KB]`
  - **Geração de vídeo por IA** (pré-renderizado, loops por estado) — provedor a especificar. `[PB]` (item em aberto nas fontes)
  - **Sem TTS/avatar em tempo real no MVP.** `[PB]`
- **Base de conhecimento:** mecanismo que carregue escopo + fontes-semente por persona (provável RAG), preparado para receber a base curada futura sem retrabalho. `[KB]` `[ASSUMPTION]`
- **Compliance by design:** criptografia de dados de saúde, trilha de auditoria, consentimento — desde o dia 1. `[MR]`

---

## 9. Success Metrics

> `[ASSUMPTION]` Metas numéricas são suposições de planejamento (derivadas do espírito das fontes), a validar com design partners.

### Métricas de negócio
- **Conversão de demo:** % de demos que viram trial (sinal do "uau"). `[MR]`
- **Trial → pago:** % de conversão. `[MR]`
- **Assinantes pagantes:** rumo a ~75–250 em 24 meses (faixa SOM). `[MR]`
- **ARR:** rumo a R$ 270k–900k ano 2. `[MR]`
- **Disposição a pagar validada:** R$ 349–499/mês no tier Board. `[MR]`

### Métricas de produto / experiência
- **Adoção em consulta:** % de consultas do usuário com o board ativo.
- **Taxa de aceite de sugestões:** % de contribuições dispensadas como úteis vs. ignoradas (sinal de relevância).
- **Taxa de uso de "silenciar" / "Modo Foco":** indicador-chave de ruído. **Se alta, default deve migrar para um "Quiet Board"** (mitigação de risco). `[UX]`
- **Profundidade clínica percebida:** avaliação qualitativa dos design partners (o fosso é a profundidade, não o avatar). `[MR]`
- **Contato visual com o paciente preservado** (avaliação no piloto). `[UX]`

---

## 10. Risks

| # | Risco | Sev. | Origem | Mitigação |
|---|-------|------|--------|-----------|
| R1 | **Regulatório (CFM):** IA em decisão clínica e responsabilidade médica (Res. 2.314/2022). | Alta | `[MR]` | Posicionar como apoio (NFR10); consultoria jurídica desde o dia 1; trilha de auditoria; disclaimers (FR19). |
| R2 | **LGPD / dados sensíveis de saúde.** | Alta | `[MR]` | Arquitetura rigorosa (NFR9); consentimento (FR20); criptografia e auditoria. |
| R3 | **Board Ativo distrai na consulta real** (compete com o paciente pela atenção). | Alta | `[UX]` | 5 guarda-corpos (NFR1–4) + Modo Foco (FR16); medir uso de silenciar no piloto; migrar default se necessário. |
| R4 | **Ceticismo médico / percepção de gimmick / uncanny valley.** | Média | `[MR]` `[PB]` | Ancorar valor na profundidade clínica, não no avatar; qualidade de vídeo (NFR6); KOLs reais para credibilidade. |
| R5 | **"Good enough":** Nova Health a R$ 149/mês basta para quem só quer copiloto por chat. | Média | `[MR]` | Diferenciar por board humanizado vertical + segurança; mirar nicho premium, não preço. |
| R6 | **Custo unitário** de IA/vídeo pressiona margem. | Média | `[MR]` `[PB]` | Vídeo pré-renderizado (NFR7); modularidade de fornecedores (NFR8); sem streaming no MVP. |
| R7 | **Threat of new entry:** Nova Health (ou outro) adiciona personas/avatar. | Média-Alta | `[MR]` | Construir o fosso rápido: base curada + marca das personas + dados de uso; registrar identidade das personas. |
| R8 | **Base curada ainda não existe** (MVP roda na semente). | Média | `[KB]` | Semente para validar/demonstrar; arquitetura pronta para receber a base curada (NFR/Tech assumptions). |
| R9 | **Números de mercado são estimativas** (não há pesquisa primária). | Média | `[MR]` | Validar com 8–12 nutrólogos antes de escalar; demo cedo. |

---

## 11. Roadmap (Fases)

> Sequência de produto herdada da pesquisa, **adaptada** às decisões de MVP (texto-first, sem voz). `[MR]` `[PB]`

### Fase 1 — MVP: Board por Texto (este PRD)
- Transcrição PT-BR ao vivo + 3 personas ativas por **texto** + vídeo silencioso por IA + painel lateral + guarda-corpos + documentação básica + compliance.
- **Objetivo:** validar adoção, relevância das sugestões e percepção de profundidade no nicho premium; gerar primeiros casos de sucesso.
- **Tier comercial-alvo:** Board (~R$ 349–499/mês). `[MR]`

### Fase 2 — Voz / TTS
- Adicionar **voz com persona** (TTS consistente por doutor) para conversa por áudio. `[PB]` `[MR]`
- **Objetivo:** aprofundar a humanização e a sensação de board presente.

### Fase 3 — Avatar Interativo em Tempo Real
- Evoluir do vídeo pré-renderizado para **avatar interativo** (streaming, turn-taking de baixa latência). `[MR]` `[PB]`
- **Objetivo:** experiência premium completa; reavaliar custo/margem.

### Trilhas transversais (acontecem em paralelo, não são "fases finais")
- **Base de conhecimento curada** (o fosso): integrar a curadoria clínica por especialidade assim que o usuário a fornecer — substitui a semente. `[KB]` `[PB]`
- **Compliance & regulatório:** consultoria CFM/LGPD contínua desde a Fase 1. `[MR]`
- **Calibração de ruído:** ajustar limiar de relevância e rate limit com dados reais do piloto. `[UX]`

### Expansões futuras (fora do roadmap de produto-núcleo)
- Modo "paciente-visível" (marketing da clínica). `[MR]` Opportunity 3
- B2B / licenças de clínica (Segment 3) com branding institucional. `[MR]`

---

## 12. Open Items (Herdados das Fontes)

| # | Item | Origem |
|---|------|--------|
| O1 | Receber e integrar a **base de estudos curada** de cada persona. | `[PB]` `[KB]` |
| O2 | Calibrar **limiar de relevância** e **rate limit** com teste de médicos reais. | `[UX]` |
| O3 | Definir gatilho preciso de **"pausa natural"** na fala (silêncio de N s? fim de turno?). | `[UX]` |
| O4 | Especificar o **provedor de geração de vídeo por IA** e o pipeline de produção dos loops. | `[PB]` `[UX]` |
| O5 | **Pesquisa primária** com 8–12 nutrólogos para validar mercado e reação ao board. | `[MR]` |
| O6 | Especificar visual final (cores, animação do pulso, transição de estados de vídeo). | `[UX]` |
| O7 | Validar profundidade exata da **documentação básica** (FR17). | `[ASSUMPTION]` |

---

## 13. Assumptions Log (Article IV — itens NÃO derivados das fontes)

| ID | Suposição | Status |
|----|-----------|--------|
| A1 | Documentação básica = transcrição estruturada + nota clínica editável (não SOAP completo). | A validar com design partners |
| A2 | Integração com EHR/prontuário de terceiros fica fora do MVP. | Decisão de escopo |
| A3 | Acessibilidade alvo: WCAG AA. | A confirmar com @ux |
| A4 | Plataforma: Web Responsive, desktop-first. | A confirmar |
| A5 | Latência de transcrição alvo: < 2–3s. | A definir com @architect |
| A6 | Arquitetura: Monorepo + serverless modular + RAG para base de conhecimento. | Decisão do @architect |
| A7 | Testing: Unit + Integration no MVP. | Decisão do @architect/@qa |
| A8 | Persona de usuário nomeada "Dra. Helena / Dr. Carlos" (ilustrativa; segmentos vêm de `[MR]`). | Ilustrativo |

---

## 14. Next Steps

### UX Expert Prompt
> @ux-design-expert (Uma): usando este PRD e `docs/board-ux-design.md`, produza os wireframes da Tela de Consulta (painel lateral fixo + feed), as 4 variantes de mensagem (⚠️/💡/🔍/📋), os 3 estados de vídeo por persona e o fluxo do Modo Foco. Valide a hierarquia visual de segurança (NFR4) e o decaimento visual (NFR3).

### Architect Prompt
> @architect (Aria): usando este PRD, defina a arquitetura modular (NFR8) para LLM + STT PT-BR + geração de vídeo por IA pré-renderizada, o mecanismo de base de conhecimento (RAG) pronto para a base curada, a engine de gatilhos/score de relevância/rate limit (NFR1–3) e a camada de compliance LGPD/CFM (NFR9–10). Avalie complexidade e proponha o particionamento em épicos/stories.

---

*PRD gerado por Morgan (@pm / Strategist) — AIOX. Todas as afirmações rastreadas a `[MR]`/`[PB]`/`[KB]`/`[UX]` ou marcadas como `[ASSUMPTION]` (Article IV — No Invention).*
