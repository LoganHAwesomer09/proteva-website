// Link-check rules shared by the server (lib/links.js) and the app's instant preview.
// The domain parser (tldts) is passed in so each side can load it its own way.
import { SIGNALS } from './link-signals.js';

export function createLinkChecker(parse) {
  // Brands commonly impersonated in scams targeting older adults, with their real domains.
  const BRANDS = {
    paypal: ['paypal.com', 'paypal.me'],
    amazon: ['amazon.com', 'amazon.co.uk', 'amazon.ca', 'amzn.to', 'amazon.de'],
    apple: ['apple.com', 'icloud.com'],
    icloud: ['icloud.com', 'apple.com'],
    microsoft: ['microsoft.com', 'live.com', 'office.com', 'outlook.com'],
    google: ['google.com', 'youtube.com', 'gmail.com'],
    netflix: ['netflix.com'],
    facebook: ['facebook.com', 'fb.com', 'meta.com'],
    venmo: ['venmo.com'],
    zelle: ['zellepay.com', 'zelle.com'],
    coinbase: ['coinbase.com'],
    chase: ['chase.com'],
    wellsfargo: ['wellsfargo.com', 'wf.com'],
    bankofamerica: ['bankofamerica.com', 'bofa.com'],
    citibank: ['citi.com', 'citibank.com'],
    usps: ['usps.com'],
    fedex: ['fedex.com'],
    ups: ['ups.com'],
    dhl: ['dhl.com'],
    irs: ['irs.gov'],
    medicare: ['medicare.gov'],
    ssa: ['ssa.gov'],
    socialsecurity: ['ssa.gov'],
    walmart: ['walmart.com'],
    costco: ['costco.com'],
    geeksquad: ['geeksquad.com', 'bestbuy.com'],
    norton: ['norton.com'],
    mcafee: ['mcafee.com'],
    docusign: ['docusign.com', 'docusign.net'],
    ebay: ['ebay.com']
  };
  const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'ow.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy', 'tiny.cc', 'buff.ly', 't.ly', 's.id']);
  const RISKY_TLDS = new Set(['zip', 'mov', 'top', 'xyz', 'click', 'country', 'gq', 'tk', 'ml', 'cf', 'ga', 'work', 'support', 'rest', 'cam', 'icu', 'cyou', 'sbs', 'buzz', 'monster', 'quest', 'bond']);
  const BAIT_WORDS = /(login|log-in|signin|sign-in|verify|verification|account|secure|security|update|unlock|suspend|billing|refund|support|helpdesk|wallet|confirm)/i;
  // Digits and characters scammers swap in for letters.
  const LOOKALIKE = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's' };


  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let previous = row[0]; row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const current = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = current;
      }
    }
    return row[b.length];
  }
  const normalize = text => text.toLowerCase().replace(/[01345789@$]/g, c => LOOKALIKE[c] || c).replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/[^a-z]/g, '');
  const officialFor = brand => BRANDS[brand];
  const isOfficial = (domain, brand) => officialFor(brand).includes(domain);

  // Finds links in free text: full URLs and bare domains such as "paypa1-secure.com/login".
  function extractUrls(text, max = 10) {
    const found = [];
    const pattern = /\b((?:https?:\/\/|www\.)[^\s<>"'()]+|[a-z0-9][a-z0-9-]{0,62}(?:\.[a-z0-9-]{1,63})*\.[a-z]{2,24}(?:\/[^\s<>"'()]*)?)/gi;
    for (const match of String(text || '').matchAll(pattern)) {
      const before = String(text).slice(Math.max(0, match.index - 1), match.index);
      if (before === '@' || before === '.' || before === '/') continue; // part of an email address or a longer word
      let raw = match[1].replace(/[.,;:!?\]}>]+$/, '');
      if (/^[^/@]+@/.test(raw) && !/^https?:/i.test(raw)) continue; // an email address, not a link
      if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;
      let url;
      try { url = new URL(raw); } catch { continue; }
      const parsed = parse(url.hostname);
      if (!parsed.isIp && !parsed.domain) continue;
      if (!parsed.isIp && !parsed.isIcann) continue;
      if (!found.some(item => item.href === url.href)) found.push({ href: url.href, explicitScheme: /^https?:\/\//i.test(match[1]), url });
      if (found.length >= max) break;
    }
    return found;
  }

  // analyzeUrl: returns the registrable domain, warning signals, and an overall risk level.
  function analyzeUrl(href, { explicitScheme = true } = {}) {
    const url = href instanceof URL ? href : new URL(href);
    const parsed = parse(url.hostname);
    const domain = parsed.isIp ? url.hostname : (parsed.domain || url.hostname);
    const signals = new Set();
    if (url.username || url.password) signals.add('user-info');
    if (parsed.isIp) signals.add('ip-address');
    if (/(^|\.)xn--/.test(url.hostname) || /[^ -~]/.test(url.hostname)) signals.add('unusual-characters');
    if (SHORTENERS.has(domain)) signals.add('shortened');
    if (parsed.publicSuffix && RISKY_TLDS.has(parsed.publicSuffix)) signals.add('risky-ending');
    if (url.hostname.split('.').length > 4 || url.hostname.length > 50) signals.add('many-subdomains');
    if (explicitScheme && url.protocol === 'http:' && !parsed.isIp) signals.add('not-secure');

    let impersonates = null;
    const officialSomewhere = Object.keys(BRANDS).some(brand => isOfficial(domain, brand));
    if (!parsed.isIp && parsed.domainWithoutSuffix && !officialSomewhere) {
      const core = parsed.domainWithoutSuffix.toLowerCase();
      const parts = [normalize(core), ...core.split(/[-.]/).map(normalize)].filter(Boolean);
      const sub = normalize(parsed.subdomain || '');
      for (const brand of Object.keys(BRANDS)) {
        // Allowed typo distance grows with name length so short words like "apply" are not flagged as "apple".
        const allowed = brand.length >= 8 ? 2 : brand.length >= 6 ? 1 : 0;
        const close = parts.some(part => part === brand || (allowed && editDistance(part, brand) <= allowed));
        const contains = brand.length >= 6 && parts[0].includes(brand);
        if (close || contains) { impersonates ??= brand; signals.add('brand-lookalike'); }
        else if (!impersonates && brand.length >= 4 && sub.includes(brand)) { impersonates = brand; signals.add('brand-in-subdomain'); }
      }
    }
    const pathAndHost = url.hostname + url.pathname;
    if (BAIT_WORDS.test(pathAndHost) && [...signals].some(id => SIGNALS[id].level !== 'low')) signals.add('bait-words');

    const levels = [...signals].map(id => SIGNALS[id].level);
    const risk = levels.includes('high') ? 'high' : levels.filter(level => level === 'medium').length >= 2 ? 'high' : levels.includes('medium') ? 'medium' : 'low';
    return {
      domain,
      risk,
      impersonates: impersonates ? officialFor(impersonates)[0] : null,
      signals: [...signals].sort((a, b) => ['high', 'medium', 'low'].indexOf(SIGNALS[a].level) - ['high', 'medium', 'low'].indexOf(SIGNALS[b].level))
    };
  }

  // Summary for the API: only domains and fixed signal IDs, never full URLs or query strings.
  function checkLinks(text) {
    return extractUrls(text).map(({ url, explicitScheme }) => analyzeUrl(url, { explicitScheme }))
      .filter((item, index, all) => all.findIndex(other => other.domain === item.domain) === index);
  }
  return { extractUrls, analyzeUrl, checkLinks };
}
