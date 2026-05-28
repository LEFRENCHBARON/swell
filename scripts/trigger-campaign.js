const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('wss://connect.anchorbrowser.io/?sessionId=c5761a16-6fad-4af3-afdd-9010489d9cca');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  console.log('Triggering activation email campaign...');
  const response = await page.request.post('https://swell.polsia.app/api/admin/send-activation-emails', {
    headers: {
      Authorization: 'Bearer e446f07fb83d882c57b31f2193ee69719e3ea22e03449b6db08997f6c29d548c',
      'Content-Type': 'application/json',
    },
  });

  const status = response.status();
  const body = await response.text();
  console.log(`Status: ${status}`);
  console.log('Response:', body);

  await browser.close();
  process.exit(0);
})();