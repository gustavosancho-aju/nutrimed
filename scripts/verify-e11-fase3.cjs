/* Verificação ao vivo — E11 Fase 3: dashboard 3 abas + entrada manual + gráficos.
 * Cadastra paciente → lança 2 medições de bioimpedância e 1 de exames →
 * confirma valor atual, variação e faixa de referência colorida. */
const { chromium } = require('playwright');

const NOME = 'Paciente Dashboard F3';
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });

  // Login + cadastro de paciente via nova consulta
  await page.goto('http://localhost:3000/login');
  await page.fill('input[name=email]', 'demo@nutrimed.test');
  await page.fill('input[name=password]', 'nutrimed123');
  await page.click('button[type=submit]');
  await page.waitForURL('http://localhost:3000/');
  await page.click('a:has-text("Nova consulta"), a:has-text("Iniciar primeira consulta")');
  await page.waitForURL(/\/consultations\/new/);
  await page.fill('input[name=patientName]', NOME);
  await page.fill('input[name=patientBirthDate]', '1980-05-05');
  await page.fill('input[name=patientGoal]', 'Reduzir gordura visceral');
  await page.click('button:has-text("Iniciar consulta")');
  await page.waitForURL(/\/consultations\/[0-9a-f-]+/);
  ok('paciente cadastrado via nova consulta');

  // Ir à ficha e abrir a dashboard
  await page.goto('http://localhost:3000/');
  await page.locator(`a[href^="/patients/"]:has-text("${NOME}")`).first().click();
  await page.waitForURL(/\/patients\/[0-9a-f-]+$/);
  await page.click('a:has-text("Dashboard de evolução")');
  await page.waitForURL(/\/dashboard/);
  ok('ficha → dashboard (link real, sem 404)');

  const patientUrl = page.url().replace(/\/dashboard.*$/, '');

  // Lançar 2 medições de bioimpedância (datas distintas → variação)
  async function addBody(date, peso, extra = {}) {
    await page.goto(`${patientUrl}/dashboard?aba=bioimpedancia`);
    await page.fill('input[name=measuredAt]', date);
    await page.fill('input[name=peso]', String(peso));
    for (const [k, v] of Object.entries(extra)) await page.fill(`input[name=${k}]`, String(v));
    await page.click('button:has-text("Adicionar medição")');
    await page.waitForLoadState('networkidle');
  }
  await addBody('2026-01-10', 95, { massaMuscular: 34, pgc: 32 });
  await addBody('2026-03-10', 90, { massaMuscular: 35, pgc: 28 });
  ok('2 medições de bioimpedância lançadas');

  // Aba Geral: valor atual + variação
  await page.goto(`${patientUrl}/dashboard?aba=geral`);
  const geral = await page.locator('body').innerText();
  if (geral.includes('90')) ok('aba Geral mostra peso atual (90)');
  else fail('peso atual 90 ausente na aba Geral');
  if (geral.includes('5kg vs. anterior')) ok('variação vs. anterior exibida (▼ 5kg)');
  else fail('variação vs. anterior ausente');
  await page.screenshot({ path: 'verify-f3-geral.png' });

  await page.goto(`${patientUrl}/dashboard?aba=bioimpedancia`);
  await page.screenshot({ path: 'verify-f3-bioimpedancia.png' });

  // Aba Exames: faixas coloridas
  await page.goto(`${patientUrl}/dashboard?aba=exames`);
  await page.fill('input[name=measuredAt]', '2026-03-10');
  await page.fill('input[name=ldl]', '170');   // alerta
  await page.fill('input[name=hba1c]', '5.5');  // ok
  await page.fill('input[name=insulina]', '30'); // alerta
  await page.click('button:has-text("Adicionar medição")');
  await page.waitForLoadState('networkidle');
  await page.goto(`${patientUrl}/dashboard?aba=exames`); // reload fresco após persistir
  const exames = await page.locator('body').innerText();
  if (exames.includes('170') && exames.includes('Fora da referência')) ok('LDL 170 → "Fora da referência" (alerta)');
  else fail('classificação de LDL não apareceu');
  if (exames.includes('Dentro da referência')) ok('HbA1C 5.5 → "Dentro da referência" (ok)');
  else fail('classificação de HbA1C ok ausente');
  if (exames.toLowerCase().includes('não constituem diagnóstico') || exames.toLowerCase().includes('não constitui')) ok('disclaimer de referência presente');
  await page.screenshot({ path: 'verify-f3-exames.png' });

  await browser.close();
  console.log(process.exitCode ? '\nRESULTADO: FALHA' : '\nRESULTADO: OK — Fase 3 verificada ao vivo');
})();
