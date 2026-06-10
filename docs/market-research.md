# Market Research Report: NutriMed — Board de Especialistas de IA Humanizados para Nutrologia

> **Autor:** Atlas (Business Analyst) · **Data:** 2026-06-05 · **Status:** Draft v1.0
> **Comando:** `*perform-market-research` · **Template:** market-research-template-v2

---

## Executive Summary

A **NutriMed** propõe um produto que não existe hoje no mercado em sua forma completa: um **board virtual de 3 especialistas de IA humanizados** — um cardiologista, um endocrinologista e um nutrólogo sênior — cada um com **nome, história, personalidade e base de estudos própria**, que **acompanham a consulta ao vivo** (transcrição em tempo real), e com os quais o nutrólogo **conversa por voz** e os vê em **vídeo (avatar interativo)**, como se fossem colegas presentes na sala dando segunda opinião e direcionamento técnico.

**Achado central da pesquisa:** o mercado já resolveu, separadamente, **cada bloco** dessa proposta — transcrição clínica em tempo real (Nova Health, Abridge), copiloto consultivo de IA, avatares de vídeo interativos em tempo real (HeyGen LiveAvatar, Tavus, Anam, D-ID), voz conversacional com persona (NVIDIA PersonaPlex), e o conceito de "board multidisciplinar" (virtual tumor boards). **Ninguém integrou tudo isso** em um produto de **personas médicas humanizadas e persistentes** voltado à **nutrologia brasileira**. Esse é um espaço em branco real e defensável.

**Oportunidade:** mercado em estágio *Early Adopter* (transcrição já cruzou o abismo; o "board humanizado por voz+vídeo" ainda é *Innovators*). Recomenda-se **entrada por nicho** — nutrólogos de clínicas de emagrecimento/obesidade/longevidade premium — com pricing de assinatura individual.

**Riscos dominantes:** (1) regulatório (CFM Resolução 2.314/2022 sobre telemedicina e o debate sobre IA em decisão médica; responsabilidade médica); (2) o conceito de "avatar humanizado" pode gerar desconforto/uncanny valley ou percepção de gimmick se a profundidade clínica não sustentar; (3) custo de avatar em tempo real é alto e pode pressionar a margem.

**Veredito estratégico:** **prosseguir**, mas com o diferencial ancorado na **profundidade clínica cardiometabólica das personas** (a base de estudos curada), e não no avatar em si. O avatar é o *encantamento*; a base de conhecimento é o *fosso competitivo*.

---

## Research Objectives & Methodology

### Research Objectives

Esta pesquisa informa a decisão **go / no-go** sobre desenvolver a NutriMed e, se "go", como posicioná-la.

Perguntas a responder:
1. Já existe uma solução de IA que transcreva consultas E ofereça consulta consultiva nas 3 especialidades (nutrologia, cardiologia, endocrinologia)?
2. Já existe alguma com **personas humanizadas + voz + vídeo ao vivo**?
3. Qual o tamanho do mercado endereçável (foco: nutrólogo individual, nicho inicial brasileiro)?
4. Onde está o gap competitivo defensável?
5. Qual estratégia de entrada e pricing?

**Critério de sucesso da pesquisa:** identificar com evidência se a proposta é inédita, dimensionar o nicho inicial e produzir recomendações acionáveis de go-to-market.

### Research Methodology

- **Fontes secundárias:** pesquisa web estruturada (junho/2026), sites de produtos, repositórios GitHub, papers (arXiv, PMC/NCBI, medRxiv), comparativos de mercado 2025–2026.
- **Frameworks aplicados:** TAM/SAM/SOM (bottom-up), PESTEL (parcial), Porter's Five Forces, Technology Adoption Lifecycle, Jobs-to-be-Done.
- **Janela de coleta:** junho/2026.
- **Limitações e premissas:**
  - Não houve pesquisa primária (entrevistas com nutrólogos) — **recomendada como próximo passo**.
  - Números de população médica brasileira são **estimativas** baseadas em ordens de grandeza públicas de CFM/sociedades (ABRAN/SBEM/SBC) e devem ser validados com dados oficiais antes de decisões de investimento.
  - Pricing de avatar em tempo real baseado em ranges públicos de plataformas; sujeito a negociação enterprise.

---

## Market Overview

### Market Definition

- **Categoria de produto:** Software clínico assistivo de IA (ambient clinical intelligence) com camada de **personas conversacionais humanizadas** (voz + avatar de vídeo em tempo real) atuando como board multidisciplinar de apoio à decisão.
- **Escopo geográfico:** Brasil — entrada por **nicho** (nutrólogos de clínicas de emagrecimento/obesidade/longevidade e medicina integrativa premium).
- **Segmento de cliente:** **Nutrólogo individual** (médico autônomo ou de clínica privada) como pagador primário.
- **Posição na cadeia de valor:** camada de software SaaS sobre infraestrutura de terceiros (LLM, STT/transcrição, TTS/voz, avatar API), vendida diretamente ao médico (B2C/B2P — business-to-professional).

### Market Size & Growth

> ⚠️ Todos os números abaixo são **estimativas de ordem de grandeza** para planejamento. Validar com dados oficiais (CFM, ABRAN, SBEM, SBC, DataSUS) antes de uso financeiro. Cálculos detalhados no Apêndice B.

#### Total Addressable Market (TAM)

TAM = todos os médicos das 3 especialidades no Brasil que poderiam, em tese, usar um board de IA cardiometabólico.

| Especialidade | Médicos no Brasil (estimativa) | Fonte/base |
|---|---|---|
| Nutrologia | ~3.000–4.000 com título ABRAN (+ milhares praticando) | Ordem de grandeza ABRAN/CFM |
| Endocrinologia | ~5.000–7.000 | Ordem de grandeza SBEM/CFM |
| Cardiologia | ~14.000–16.000 | Ordem de grandeza SBC/CFM |
| **Total addressable (médicos)** | **~22.000–27.000** | — |

Com ticket-alvo de **R$ 300/mês** (R$ 3.600/ano):
**TAM ≈ 24.000 médicos × R$ 3.600 = ~R$ 86 milhões/ano.**

#### Serviceable Addressable Market (SAM)

SAM = nutrólogos brasileiros (o cliente primário e o coração do produto), pois a proposta é *voltada a auxiliar o nutrólogo*.

- Universo realista de médicos atuando em nutrologia (titulados + praticantes ativos com perfil digital): **~8.000–12.000**.
- SAM ≈ **10.000 nutrólogos × R$ 3.600/ano = ~R$ 36 milhões/ano.**

#### Serviceable Obtainable Market (SOM)

SOM = nicho inicial captável em 18–24 meses: nutrólogos de clínicas de emagrecimento/obesidade/longevidade premium, early adopters digitais.

- Nicho estimado: **~1.500–2.500** profissionais.
- Captura realista de 5–10% em 24 meses = **~150 assinantes pagantes**.
- SOM ano 2 ≈ **150 × R$ 3.600 = ~R$ 540 mil/ano de ARR** (base inicial; expansível para o SAM).

> **Leitura estratégica:** o mercado não é gigante em volume, mas tem **ticket alto, baixa concorrência direta no formato proposto e alta disposição a pagar** em clínicas premium. É um mercado de **profundidade, não de escala bruta** — coerente com a estratégia de nicho.

### Market Trends & Drivers

#### Key Market Trends

1. **Ambient AI scribe virou padrão (2025–2026):** transcrição + nota clínica automática deixou de ser diferencial e virou commodity (Abridge "Best in KLAS" 2025 e 2026; no Brasil, Nova Health, Voa, Dr. Assistente). **Impacto:** a transcrição não é mais vendável isoladamente — precisa estar embutida e gratuita no valor maior.
2. **Avatares interativos em tempo real amadureceram:** HeyGen LiveAvatar, Tavus, Anam e D-ID já oferecem face humana, turn-taking de baixa latência e "empatia visual". **Impacto:** a camada de vídeo ao vivo da NutriMed é tecnicamente viável hoje via API.
3. **Voz com persona consistente:** NVIDIA PersonaPlex permite definir papel, voz e personalidade persistentes por prompt de áudio+texto. **Impacto:** "humanizar cada especialista" com voz própria é factível.
4. **Copiloto clínico consultivo já validado academicamente:** estudos mostram que interfaces LLM interativas melhoram diagnóstico diferencial vs. busca tradicional, com destaque para endocrinologia (sintomas que se sobrepõem ao cardiovascular). **Impacto:** o núcleo cardiometabólico tem respaldo científico.
5. **Boom da medicina de emagrecimento/metabólica (GLP-1):** a explosão de tratamentos para obesidade/diabetes elevou a demanda por nutrologia e cruzamento com risco cardiovascular e endócrino. **Impacto:** o timing do eixo cardiometabólico é excelente.

#### Growth Drivers

- Sobrecarga administrativa e burnout médico (transcrição economiza ~2h/dia).
- Insegurança do nutrólogo em conduta cardiometabólica complexa (interações medicamentosas, GLP-1, reposições) → demanda por "segunda opinião instantânea".
- Maturação e barateamento relativo de LLMs, STT, TTS e avatares.
- Valorização da experiência premium em clínicas de longevidade.

#### Market Inhibitors

- **Incerteza regulatória** sobre IA em decisão clínica e responsabilidade médica (CFM).
- **Ceticismo médico** com IA "que opina" e com avatares (risco de percepção de gimmick / uncanny valley).
- **Custo de avatar em tempo real** (streaming de vídeo gerado) pressiona margem unitária.
- **LGPD / dados sensíveis de saúde** exigem arquitetura rigorosa.
- **Risco de "good enough":** Nova Health a R$ 149/mês pode bastar para quem só quer o copiloto por chat.

---

## Customer Analysis

### Target Segment Profiles

#### Segment 1: Nutrólogo de Clínica de Emagrecimento/Longevidade Premium (nicho inicial — PRIORITÁRIO)

- **Description:** Médico nutrólogo em clínica privada de emagrecimento, obesidade, longevidade ou medicina integrativa, com clientela de alto padrão.
- **Size:** ~1.500–2.500 profissionais (estimativa do nicho).
- **Characteristics:** Digitalmente maduro, investe em diferenciação de experiência, lida com casos cardiometabólicos complexos (GLP-1, hipertensão, dislipidemia, tireoide), atende particular.
- **Needs & Pain Points:** Insegurança em condutas que cruzam cardio/endo; medo de interação medicamentosa; quer impressionar e reter pacientes premium; falta de tempo para documentação.
- **Buying Process:** Decisão individual e rápida, sensível a demonstração ("uau"), indicação por pares.
- **Willingness to Pay:** **Alta** — R$ 300–600/mês é aceitável se entregar segurança clínica + experiência premium.

#### Segment 2: Nutrólogo Generalista / Consultório Próprio (expansão SAM)

- **Description:** Nutrólogo autônomo de consultório, atendimento misto (convênio/particular).
- **Size:** ~8.000–10.000.
- **Characteristics:** Mais sensível a preço, adoção mais lenta, valoriza economia de tempo.
- **Needs & Pain Points:** Reduzir burocracia, apoio em decisões pontuais.
- **Buying Process:** Compara preço, quer trial gratuito.
- **Willingness to Pay:** **Média** — R$ 150–300/mês.

#### Segment 3: Clínicas/Centros Médicos (expansão B2B — futuro)

- **Description:** Clínicas que compram licenças para vários médicos.
- **Size:** Centenas de clínicas.
- **Characteristics:** Compra B2B, ciclo longo, exige integração e compliance.
- **Needs & Pain Points:** Padronização de conduta, diferenciação institucional, governança.
- **Willingness to Pay:** Ticket maior por licença, mas negociação longa.

### Jobs-to-be-Done

#### Functional Jobs
- Documentar a consulta automaticamente (transcrição → prontuário/SOAP).
- Tirar dúvidas técnicas em tempo real sem sair da consulta.
- Checar interações medicamentosas e doses no eixo cardiometabólico.
- Receber direcionamento de conduta/protocolo (reposição, GLP-1, modulação metabólica).
- Obter "segunda opinião" estruturada de cardio e endo durante o atendimento.

#### Emotional Jobs
- Sentir **segurança e confiança** ao conduzir casos complexos.
- Reduzir a **ansiedade** de estar sozinho na decisão.
- Sentir-se **acompanhado** por "colegas" (as personas) — diferencial emocional único da humanização.

#### Social Jobs
- Ser percebido pelo paciente como **médico moderno, tecnológico e completo** (board multidisciplinar ao vivo impressiona).
- Ser visto pelos pares como **inovador** e referência.

### Customer Journey Mapping

Para o segmento primário (clínica premium):

1. **Awareness:** indicação de colega, redes sociais médicas, demonstração em congresso de nutrologia/obesidade.
2. **Consideration:** assiste a um demo ao vivo — vê o avatar conversando; avalia profundidade clínica das respostas.
3. **Purchase:** gatilho = "uau" do demo + um caso real respondido com precisão; trial gratuito converte.
4. **Onboarding:** escolhe especialidade, conhece as 3 personas (nome/história), faz a primeira consulta acompanhada.
5. **Usage:** usa em consultas complexas; conversa por voz com o endocrinologista/cardiologista de IA; documentação sai pronta.
6. **Advocacy:** indica a pares; usa o board como diferencial de marketing da própria clínica.

---

## Competitive Landscape

### Market Structure

- **Mercado fragmentado** em duas frentes que **ainda não convergiram**:
  - **Frente A — Ambient scribe + copiloto clínico** (madura, competitiva, em commoditização): Nova Health, Abridge, Nuance DAX, Nabla, Voa, Dr. Assistente, HiDoctor.
  - **Frente B — Avatares/voz conversacional humanizada** (madura tecnicamente, mas não aplicada a board médico consultivo): HeyGen, Tavus, Anam, D-ID, NVIDIA PersonaPlex.
- **Intensidade competitiva:** alta na Frente A, **quase nula na interseção** (board de personas médicas humanizadas por voz+vídeo para nutrologia).

### Major Players Analysis

| Player | Descrição | Força | Fraqueza p/ a NutriMed | Pricing |
|---|---|---|---|---|
| **Nova Health** (BR) | Transcrição + copiloto clínico, 55+ especialidades | Já tem copiloto consultivo em PT-BR, barato | Genérico, sem personas, sem voz/vídeo, sem profundidade vertical | R$ 149,90/mês |
| **Abridge** (US) | Ambient scribe líder (Best in KLAS) | Marca, integração EHR | Inglês, EHR americano, sem nutrologia BR, sem humanização | Enterprise |
| **Nuance DAX / Nabla** (US/EU) | Ambient scribe enterprise | Escala, compliance | Foco documentação, não board humanizado | Enterprise |
| **Voa / Dr. Assistente / HiDoctor** (BR) | Transcrição PT-BR | Localização BR | Sem board, sem voz/vídeo, copiloto raso | R$ ~ / créditos |
| **HeyGen / Tavus / Anam / D-ID** | Avatares interativos em tempo real (API) | Tech de avatar pronta | São *infraestrutura*, não produto clínico — **potenciais fornecedores, não concorrentes** | API/uso |
| **NVIDIA PersonaPlex** | Voz conversacional com persona | Persona consistente | Infra, não produto clínico — **fornecedor potencial** | Plataforma |

**Análogos conceituais (não concorrentes diretos):** *Virtual Tumor Boards* (NAVIFY, smart virtual assistants em oncologia) validam o conceito de "board multidisciplinar assistido por IA" — mas são institucionais, oncológicos e sem personas humanizadas conversacionais.

### Competitive Positioning

- **Nova Health e similares** posicionam-se em *eficiência/documentação* ("ganhe 2h/dia").
- **Avatares** posicionam-se em *engajamento/presença humana* (vendas, suporte).
- **NutriMed** ocupa um quadrante vazio: **"um board de colegas especialistas ao seu lado"** — combinando *profundidade clínica vertical (cardiometabólica)* + *presença humana (voz+vídeo)* + *relação contínua com personas nomeadas*.

**Gaps de mercado exploráveis:**
1. Nenhuma solução tem **personas médicas persistentes e humanizadas** (nome/história/base de estudos própria).
2. Nenhuma faz **board de 3 especialidades raciocinando em conjunto** sobre o eixo cardiometabólico.
3. Nenhuma combina **voz + vídeo ao vivo** no contexto de apoio ao médico (só ao paciente, em outros setores).
4. Nenhuma é **vertical em nutrologia brasileira**.

---

## Industry Analysis

### Porter's Five Forces Assessment

#### Supplier Power: ALTO
A NutriMed depende de fornecedores de LLM, STT, TTS e **avatar em tempo real** (HeyGen/Tavus/Anam). Esses fornecedores têm poder de preço e podem mudar termos. Mitigação: arquitetura modular que permita trocar de provedor; negociar volume; considerar avatar pré-renderizado em tiers mais baratos.

#### Buyer Power: MÉDIO
O nutrólogo individual tem alternativas baratas (Nova Health). Mas no **nicho premium** o poder do comprador cai, pois o valor percebido (segurança + experiência) supera o preço, e não há substituto equivalente no formato humanizado.

#### Competitive Rivalry: BAIXA (na interseção) / ALTA (em transcrição)
Na transcrição pura, rivalidade alta e commoditizada — **evitar competir aí**. No board humanizado vertical, rivalidade praticamente inexistente hoje.

#### Threat of New Entry: MÉDIO-ALTO
Os blocos são APIs acessíveis — um concorrente (incl. a própria Nova Health) poderia adicionar avatar + personas. **A defesa real não é a tecnologia, é a base de conhecimento clínica curada por especialidade + marca das personas + dados de uso.** É preciso construir esse fosso rápido.

#### Threat of Substitutes: MÉDIO
Substitutos: o próprio copiloto por chat (Nova Health), UpToDate, consulta a colega humano por WhatsApp, busca no Google/ChatGPT. Nenhum entrega a experiência integrada ao vivo, mas "good enough" é risco real para o segmento sensível a preço.

### Technology Adoption Lifecycle Stage

- **Transcrição/ambient scribe:** já em **Early/Late Majority** (cruzou o abismo).
- **Board humanizado por voz+vídeo para médicos:** estágio **Innovators → Early Adopters**.
- **Implicação estratégica:** vender para **early adopters** (clínicas premium inovadoras), com mensagem de visão e demonstração impactante — não para a maioria pragmática ainda.
- **Progressão esperada:** 12–24 meses para validar Early Adopters; 2–4 anos para Early Majority, condicionado a clareza regulatória do CFM.

---

## Opportunity Assessment

### Market Opportunities

#### Opportunity 1: Board Cardiometabólico Humanizado (núcleo)
- **Description:** Produto vertical com 3 personas de IA (nutrólogo sênior, cardiologista, endocrinologista) humanizadas, base de estudos curada (diretrizes ABRAN/SBEM/SBC), voz e avatar ao vivo acompanhando a consulta.
- **Size/Potential:** SAM ~R$ 36M/ano; SOM inicial ~R$ 540k ARR ano 2, escalável.
- **Requirements:** Curadoria clínica das bases por especialista humano real; design das personas; integração avatar+voz+transcrição; compliance LGPD/CFM.
- **Risks:** Regulatório; custo de avatar; ceticismo médico.

#### Opportunity 2: "Modo Documentação" embutido (cavalo de Troia)
- **Description:** Entregar a transcrição+SOAP de graça/embutida para resolver a dor já validada e baixar a barreira de entrada, com o board como upsell premium.
- **Size/Potential:** Captura de usuários sensíveis a preço, funil para o premium.
- **Requirements:** Paridade mínima com Nova Health na documentação.
- **Risks:** Comoditização; não diferencia sozinho.

#### Opportunity 3: Diferencial de marketing para a clínica
- **Description:** Posicionar o board como experiência premium que a clínica usa para atrair/reter pacientes ("aqui você é avaliado por um board completo").
- **Size/Potential:** Abre canal B2B futuro (Segment 3).
- **Requirements:** Material de marca, modo "paciente-visível" opcional.
- **Risks:** Regulatório (não pode parecer que a IA diagnostica o paciente).

### Strategic Recommendations

#### Go-to-Market Strategy
1. **Priorizar o nicho premium** (Segment 1) — early adopters com alta disposição a pagar.
2. **Posicionamento:** *"Seu board cardiometabólico ao vivo. Três especialistas ao seu lado, em cada consulta."* — ancorar em **segurança clínica e presença**, não em "transcrição".
3. **Canal:** demonstrações ao vivo em congressos de nutrologia/obesidade, marketing de indicação entre pares, conteúdo com KOLs (key opinion leaders) nutrólogos.
4. **Parcerias:** um nutrólogo, um cardiologista e um endocrinologista reais e renomados para **emprestar credibilidade e curar a base de estudos de cada persona** (também ajuda na humanização: as personas podem ser "inspiradas" neles).
5. **Sequência de produto:** MVP = transcrição + 1 persona por voz (texto→voz) → adicionar avatar de vídeo → adicionar as 3 personas em board → modo paciente-visível.

#### Pricing Strategy
- **Modelo:** assinatura SaaS mensal, individual, com tiers.
  - **Essencial** (~R$ 149–199/mês): transcrição + SOAP + 1 persona por chat/voz. (paridade competitiva)
  - **Board** (~R$ 349–499/mês): 3 personas + voz + avatar de vídeo ao vivo. (premium, núcleo)
  - **Clínica** (B2B, sob consulta): licenças múltiplas + branding.
- **Métrica de valor:** por médico/mês (não por minuto, para não punir uso).
- **Posicionamento de preço:** **acima** da Nova Health no tier Board — preço como sinal de profundidade/premium, justificado pela experiência única.

#### Risk Mitigation
- **Riscos de mercado:** validar com 8–12 nutrólogos antes de construir (pesquisa primária); demo cedo para testar reação ao avatar.
- **Riscos competitivos:** construir o fosso de **base de conhecimento curada + marca das personas** rapidamente; registrar identidade das personas; acumular dados de uso.
- **Riscos de execução:** arquitetura modular de fornecedores (avatar/voz/LLM intercambiáveis) para controlar custo e dependência; começar com avatar simples e evoluir.
- **Riscos regulatórios/compliance:** consultoria jurídica sobre CFM (Res. 2.314/2022 e normas de IA) e **LGPD** desde o dia 1; posicionar a IA explicitamente como **apoio à decisão do médico** (o médico decide — a IA assiste), nunca como diagnóstico autônomo; trilha de auditoria; consentimento de gravação.

---

## Appendices

### A. Data Sources

**Mercado brasileiro (transcrição/copiloto):**
- Nova Health — https://www.novahealth.med.br/
- Dr. Assistente — https://www.drassistente.com.br/en/
- HiDoctor LIVE — https://www.hidoctor.com.br/p/inteligencia-artificial-medicina/
- Voa Health (comparativo 2025) — https://blog.voa.health/blog/ia-e-inovacao-4/ias-transcricao-consultas-medicas-2025-50
- App Health — https://www.apphealth.com.br/ia-para-consultas-medicas
- Lya Health / CTC — https://ctctech.com.br/blog/prontuario-por-voz-ia-para-consultas-mais-ageis-e-humanizadas/
- Telepatia — https://www.telepatia.ai/en

**Mercado internacional (ambient scribe):**
- Best Medical AI Ambient Listening Tools 2026 — https://www.trytwofold.com/blog/best-medical-ai-ambient-listening-tools-2026
- DeepScribe — https://www.deepscribe.ai/resources/best-ai-medical-scribes
- S10.AI — https://s10.ai/
- Empathia AI — https://www.empathia.ai/
- Freed — https://www.getfreed.ai/

**Avatares e voz conversacional:**
- HeyGen LiveAvatar — https://www.heygen.com/interactive-avatar
- Anam (Real-Time Interactive AI Avatars API) — https://anam.ai/
- Two-Way Conversation AI Video 2026 — https://truefan.ai/blogs/two-way-conversation-ai-video
- Best AI Avatars 2026 (Life Inside) — https://www.lifeinside.io/insights/best-ai-avatars
- NVIDIA PersonaPlex — https://research.nvidia.com/labs/adlr/personaplex/

**Open source / GitHub:**
- MemoMed — https://github.com/aisemble/MemoMed
- Notetaker (Momentum) — https://www.themomentum.ai/open-source/notetaker-medical-ai
- Awesome AI Agents for Healthcare (MDTeamGPT) — https://github.com/AgenticHealthAI/Awesome-AI-Agents-for-Healthcare
- AgentClinic — https://agentclinic.github.io/
- OpenMEDLab — https://github.com/openmedlab

**Evidência acadêmica:**
- Conversational Medical AI (Mo) — https://arxiv.org/pdf/2411.12808
- Interactive & Interpretable AI Copilot (nefrologia/obstetrícia) — https://arxiv.org/pdf/2602.00726
- Medical-Grade Voice AI nurse panel (inclui cardiometabólico) — https://www.medrxiv.org/content/10.1101/2025.09.18.25336107.full.pdf
- Multidisciplinary Tumor Board Smart Virtual Assistant — https://pmc.ncbi.nlm.nih.gov/articles/PMC8761664/
- IA em nutrição/obesidade (RAG personalized nutrition) — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12054865/

### B. Detailed Calculations

**TAM (top-down por população médica):**
- Médicos addressable: ~24.000 (média das faixas das 3 especialidades)
- Ticket anual alvo: R$ 3.600 (R$ 300/mês)
- TAM = 24.000 × R$ 3.600 ≈ **R$ 86,4M/ano**

**SAM (foco nutrologia):**
- Nutrólogos ativos com perfil digital: ~10.000
- SAM = 10.000 × R$ 3.600 ≈ **R$ 36M/ano**

**SOM (nicho premium, 24 meses):**
- Nicho premium: ~2.000
- Captura 7,5% (ponto médio 5–10%) ≈ 150 pagantes
- SOM = 150 × R$ 3.600 ≈ **R$ 540k ARR**

> Sensibilidade: a 10% de captura sobre 2.500 = 250 pagantes → ~R$ 900k ARR. A 5% sobre 1.500 = 75 → ~R$ 270k ARR. Faixa SOM ano 2: **R$ 270k–900k**.

### C. Additional Analysis

**Síntese do gap (resposta direta à pergunta original):**

> *"Já existe uma solução de IA que transcreve consultas das 3 especialidades para o médico tirar dúvidas e pegar direcionamentos?"*
> **Sim — Nova Health (BR) já faz transcrição + copiloto consultivo cobrindo cardio/endo/nutro.**
>
> *"Já existe no formato de especialistas humanizados (nome, história, base de estudos), com voz para conversar e vídeo ao vivo acompanhando?"*
> **Não. Esse formato não existe no mercado.** Os blocos (avatar em tempo real, voz com persona, board multidisciplinar) existem isoladamente, mas ninguém os integrou em personas médicas persistentes verticais para nutrologia. **É um espaço em branco defensável — desde que o fosso seja a profundidade clínica curada, não o avatar.**

---

*Documento gerado por Atlas (Business Analyst) — AIOX. Próximo passo sugerido: validação primária com nutrólogos (`*brainstorm`) e/ou handoff para @pm (Morgan) transformar em Project Brief/PRD.*
