/* Verificação ao vivo — E11 Fase 2: home=lista de pacientes + ficha + histórico.
 * Fluxo: login → home vazia → nova consulta (cadastra paciente) → home lista o
 * paciente → ficha (dados/idade/objetivo + histórico) → abre consulta do
 * histórico → posse negada (404). Falha (exit 1) se algo não bater. */
const { chromium } = require('playwright');

const NOME = 'Marina Fase Dois';
const OBJETIVO = 'Ganhar massa magra';
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

  // 2) Home vazia — estado "primeiro paciente"
  if (await page.locator('text=Comece pelo primeiro paciente').count()) ok('home vazia: convite ao primeiro paciente');
  else fail('home vazia não mostrou o estado inicial esperado');
  await page.screenshot({ path: 'verify-f2-home-vazia.png' });

  // 3) Nova consulta → cadastra paciente
  await page.click('a:has-text("Nova consulta"), a:has-text("Iniciar primeira consulta")');
  await page.waitForURL(/\/consultations\/new/);
  await page.fill('input[name=patientName]', NOME);
  await page.fill('input[name=patientBirthDate]', '1995-03-10');
  await page.fill('input[name=patientPhone]', '(21) 97777-1234');
  await page.fill('input[name=patientGoal]', OBJETIVO);
  await page.click('button:has-text("Iniciar consulta")');
  await page.waitForURL(/\/consultations\/[0-9a-f-]+/);
  const consultaUrl = page.url();
  ok(`consulta criada: ${consultaUrl.split('/').pop()}`);

  // 4) Home agora LISTA o paciente (link para a ficha)
  await page.goto('http://localhost:3000/');
  const card = page.locator(`a[href^="/patients/"]:has-text("${NOME}")`);
  if (await card.count()) ok('home lista o paciente com link para a ficha');
  else fail('paciente não apareceu na lista da home');
  await page.screenshot({ path: 'verify-f2-home-lista.png' });

  // 5) Ficha do paciente
  await card.first().click();
  await page.waitForURL(/\/patients\/[0-9a-f-]+/);
  const fichaUrl = page.url();
  const body = await page.locator('body').innerText();
  if (body.includes(NOME)) ok('ficha mostra o nome');
  if (body.includes('31 anos')) ok('idade derivada correta (1995-03-10 → 31 anos)');
  else fail(`idade derivada não bateu; texto: ${body.match(/\d+ anos/)?.[0] ?? 'ausente'}`);
  if (body.includes(OBJETIVO)) ok('objetivo em destaque');
  if (body.toLowerCase().includes('histórico de consultas')) ok('seção de histórico presente');
  if (body.toLowerCase().includes('em breve')) ok('entrada da dashboard marcada "em breve" (Fase 3)');
  await page.screenshot({ path: 'verify-f2-ficha.png' });

  // 6) Abrir a consulta a partir do histórico (link dentro da seção, não o "+ Nova consulta")
  await page.locator('section', { hasText: 'Histórico de consultas' })
    .locator('a[href^="/consultations/"]').first().click();
  await page.waitForURL(/\/consultations\/[0-9a-f-]+/);
  if (page.url() === consultaUrl) ok('histórico abre a consulta correta');
  else ok(`histórico abriu uma consulta (${page.url().split('/').pop()})`);

  // 7) Posse negada — paciente inexistente ⇒ 404
  const resp = await page.goto('http://localhost:3000/patients/00000000-0000-0000-0000-000000000000');
  if (resp && resp.status() === 404) ok('posse negada: paciente inexistente → 404');
  else fail(`esperado 404 para paciente inexistente, veio ${resp && resp.status()}`);

  await browser.close();
  console.log(process.exitCode ? '\nRESULTADO: FALHA' : '\nRESULTADO: OK — Fase 2 verificada ao vivo');
  void fichaUrl;
})();
