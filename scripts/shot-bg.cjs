/* Screenshot autenticado p/ verificação visual do fundo (uso pontual de design). */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('http://localhost:3000/login');
  await page.fill('input[name=email]', 'demo@nutrimed.test');
  await page.fill('input[name=password]', 'nutrimed123');
  await page.click('button[type=submit]');
  await page.waitForURL('http://localhost:3000/');
  await page.screenshot({ path: 'bg-check-dash.png' });

  await page.click('button:has-text("Iniciar consulta")');
  await page.waitForURL(/consultations/);
  await page.screenshot({ path: 'bg-check-consent.png' });
  await page.click('button:has-text("Registrar consentimento")');
  await page.waitForSelector('text=Board');
  await page.screenshot({ path: 'bg-check-consulta.png' });
  await browser.close();
})();
