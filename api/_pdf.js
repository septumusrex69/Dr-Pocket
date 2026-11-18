// Turns report HTML into an A4 PDF with headless Chromium. On Vercel it uses @sparticuz/chromium;
// locally set CHROME_PATH to any Chromium. The footer carries the logo text, report type, range and page numbers.
import { MONTSERRAT_WOFF2 } from './_font.js';

export const FONT_CSS = `@font-face{font-family:'Montserrat';font-style:normal;font-weight:400 800;src:url(data:font/woff2;base64,${MONTSERRAT_WOFF2}) format('woff2')}`;

let browserP = null;
async function browser() {
  if (browserP) {
    const b = await browserP.catch(() => null);
    if (b?.connected) return b;
  }
  browserP = (async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    if (process.env.CHROME_PATH) return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
    const chromium = (await import('@sparticuz/chromium')).default;
    return puppeteer.launch({ args: [...chromium.args, '--font-render-hinting=none'], executablePath: await chromium.executablePath(), headless: true, defaultViewport: { width: 1200, height: 1600 } });
  })();
  return browserP;
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function htmlToPdf(html, { footer = '' } = {}) {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({
      format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;margin:0 14mm;padding-top:4px;border-top:0.5px solid #D5DEE5;display:flex;justify-content:space-between;font-family:Montserrat,Helvetica,Arial,sans-serif;font-size:7.5px;color:#5A6B7D;-webkit-print-color-adjust:exact"><span style="font-weight:700;letter-spacing:.06em">DR POCKET&nbsp;&nbsp;/&nbsp;&nbsp;${escHtml(footer)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    }));
  } finally { await page.close().catch(() => {}); }
}
