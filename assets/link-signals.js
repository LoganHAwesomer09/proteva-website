// Plain-language link warnings shared by the server checks (lib/links.js) and the app.
export const SIGNALS = {
  'user-info': { level: 'high', label: 'The link hides its real destination after an "@" sign.' },
  'ip-address': { level: 'high', label: 'The link goes to a raw number address instead of a named website.' },
  'brand-lookalike': { level: 'high', label: 'The address imitates a well-known company’s name but is not that company’s website.' },
  'brand-in-subdomain': { level: 'high', label: 'A company name appears at the start of the address, but the website it actually goes to belongs to someone else.' },
  'unusual-characters': { level: 'high', label: 'The address uses unusual characters that can make a fake site look real.' },
  'shortened': { level: 'medium', label: 'This is a shortened link, so you cannot see where it really goes.' },
  'risky-ending': { level: 'medium', label: 'The address ends in a type that is often used by scam websites.' },
  'many-subdomains': { level: 'medium', label: 'The address is unusually long and layered, a common trick to confuse readers.' },
  'bait-words': { level: 'medium', label: 'The address uses words like "login" or "verify" that scam sites use to look official.' },
  'not-secure': { level: 'low', label: 'The link does not use a secure (https) connection.' }
};
