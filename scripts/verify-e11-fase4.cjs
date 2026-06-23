/* Verificação ao vivo — E11 Fase 4: importação de laudo com validação médica.
 * Server deve rodar com LAB_EXTRACTOR=fake. Prova o gate do ADR-012: a IA
 * pré-preenche, o médico CORRIGE, e o valor SALVO é o corrigido (não o extraído). */
const { chromium } = require('playwright');

const NOME = 'Paciente Import F4';
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });

  // Login + cadastro de paciente
  await page.goto('http://localhost:3000/login');
  await page.fill('input[name=email]', 'demo@nutrimed.test');
  await page.fill('input[name=password]', 'nutrimed123');
  await page.click('button[type=submit]');
  await page.waitForURL('http://localhost:3000/');
  await page.click('a:has-text("Nova consulta"), a:has-text("Iniciar primeira consulta")');
  await page.waitForURL(/\/consultations\/new/);
  await page.fill('input[name=patientName]', NOME);
  await page.click('button:has-text("Iniciar consulta")');
  await page.waitForURL(/\/consultations\/[0-9a-f-]+/);
  ok('paciente cadastrado');

  // Ir à ficha → dashboard → importar
  await page.goto('http://localhost:3000/');
  await page.locator(`a[href^="/patients/"]:has-text("${NOME}")`).first().click();
  await page.waitForURL(/\/patients\/[0-9a-f-]+$/);
  const patientUrl = page.url();
  await page.click('a:has-text("Dashboard de evolução")');
  await page.waitForURL(/\/dashboard/);
  await page.click('a:has-text("Importar laudo")');
  await page.waitForURL(/\/import/);
  ok('dashboard → importar laudo (rota real)');

  // Upload de um PDF (conteúdo ignorado pelo fake) — tipo bioimpedância
  await page.selectOption('select[name=kind]', 'body');
  await page.setInputFiles('input[name=file]', {
    name: 'laudo-bia.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% laudo de teste\n%%EOF'),
  });
  await page.click('button:has-text("Enviar e extrair")');

  // Tela de confirmação: valores extraídos pré-preenchidos (fake: peso 84.2)
  await page.waitForSelector('text=Valores extraídos por IA');
  const pesoExtraido = await page.inputValue('input[name=peso]');
  if (pesoExtraido === '84.2') ok('rascunho pré-preenchido com o valor extraído (peso 84.2)');
  else fail(`peso extraído esperado 84.2, veio "${pesoExtraido}"`);
  await page.screenshot({ path: 'verify-f4-confirmacao.png' });

  // GATE: o médico CORRIGE o peso para 83 antes de salvar
  await page.fill('input[name=peso]', '83');
  await page.click('button:has-text("Adicionar medição")');
  await page.waitForURL(/\/dashboard/);
  ok('médico confirmou (com correção)');

  // Dashboard deve mostrar o valor CORRIGIDO (83), não o extraído (84.2)
  await page.goto(`${patientUrl}/dashboard?aba=bioimpedancia`);
  const dash = await page.locator('body').innerText();
  if (dash.includes('83')) ok('dashboard mostra o valor confirmado pelo médico (83)');
  else fail('valor confirmado 83 ausente na dashboard');
  if (!/\b84\.2\b/.test(dash)) ok('valor extraído original (84.2) NÃO foi salvo cego (gate respeitado)');
  else fail('84.2 apareceu — gravação sem confirmação?');

  await browser.close();
  console.log(process.exitCode ? '\nRESULTADO: FALHA' : '\nRESULTADO: OK — Fase 4 verificada (gate de validação médica respeitado)');
})();
