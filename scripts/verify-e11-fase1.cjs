/* Verificação ao vivo — E11 Fase 1: cadastro de paciente + consulta vinculada.
 * Fluxo: login → cadastrar novo paciente → iniciar consulta (vínculo) →
 * voltar à home → confirmar paciente no seletor → iniciar consulta com paciente
 * existente. Falha (exit 1) se qualquer passo não bater. */
const { chromium } = require('playwright');

const NOME = 'João Verificação E11';
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

  // 1) Login
  await page.goto('http://localhost:3000/login');
  await page.fill('input[name=email]', 'demo@nutrimed.test');
  await page.fill('input[name=password]', 'nutrimed123');
  await page.click('button[type=submit]');
  await page.waitForURL('http://localhost:3000/');
  ok('login');

  // 2) Home inicial — 0 pacientes ⇒ sem seletor, só o cadastro de novo
  await page.waitForSelector('legend:has-text("Novo paciente")');
  const temSelectAntes = await page.locator('select[name=patientId]').count();
  if (temSelectAntes === 0) ok('home sem pacientes: seletor ausente (esperado)');
  else ok('home já tinha pacientes de execução anterior (seletor presente)');
  await page.screenshot({ path: 'verify-home-novo.png' });

  // 3) Cadastrar novo paciente e iniciar consulta (vínculo)
  await page.fill('input[name=patientName]', NOME);
  await page.fill('input[name=patientBirthDate]', '1988-07-20');
  await page.fill('input[name=patientPhone]', '(11) 98888-7777');
  await page.fill('input[name=patientGoal]', 'Reduzir % de gordura');
  await page.click('button:has-text("Iniciar consulta")');
  await page.waitForURL(/\/consultations\/[0-9a-f-]+/);
  const consultaUrl = page.url();
  ok(`consulta criada e vinculada: ${consultaUrl.split('/').pop()}`);
  await page.screenshot({ path: 'verify-consulta.png' });

  // 4) Voltar à home — o paciente deve aparecer no seletor (listPatients/escopo)
  await page.goto('http://localhost:3000/');
  await page.waitForSelector('select[name=patientId]');
  const opcoes = await page.locator('select[name=patientId] option').allTextContents();
  const achou = opcoes.find((o) => o.includes(NOME));
  if (achou) ok(`paciente no seletor com idade derivada: "${achou.trim()}"`);
  else fail(`paciente "${NOME}" NÃO apareceu no seletor: ${JSON.stringify(opcoes)}`);
  await page.screenshot({ path: 'verify-home-com-paciente.png' });

  // 5) Caminho do paciente EXISTENTE — selecionar e iniciar nova consulta
  const value = await page.locator('select[name=patientId] option', { hasText: NOME }).getAttribute('value');
  await page.selectOption('select[name=patientId]', value);
  await page.click('button:has-text("Iniciar consulta")');
  await page.waitForURL(/\/consultations\/[0-9a-f-]+/);
  const consulta2 = page.url();
  if (consulta2 !== consultaUrl) ok(`2ª consulta (paciente existente) criada: ${consulta2.split('/').pop()}`);
  else fail('2ª consulta reusou a URL da 1ª (inesperado)');

  await browser.close();
  console.log(process.exitCode ? '\nRESULTADO: FALHA' : '\nRESULTADO: OK — fluxo da Fase 1 verificado ao vivo');
})();
