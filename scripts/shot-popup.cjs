/* Verificação visual: tiles grandes dos médicos + pop-up de contribuição. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('http://localhost:3000/login');
  await page.fill('input[name=email]', 'demo@nutrimed.test');
  await page.fill('input[name=password]', 'nutrimed123');
  await page.click('button[type=submit]');
  await page.waitForURL('http://localhost:3000/');
  await page.click('button:has-text("Iniciar consulta")');
  await page.waitForURL(/consultations/);
  await page.click('button:has-text("Registrar consentimento")');
  await page.waitForSelector('text=Board');
  await page.screenshot({ path: 'shot-tiles.png' });

  await page.click('button:has-text("Consulta simulada")');
  // espera o primeiro pop-up de contribuição aparecer
  await page.waitForSelector('[data-testid="contribution-popup"]', { timeout: 60000 });
  await page.screenshot({ path: 'shot-popup.png' });
  await page.waitForTimeout(15000);
  await page.screenshot({ path: 'shot-board-live.png' });
  await browser.close();
})();
