import { prepare, readBody, authorize, withinRateLimit } from '../lib/server.js';

// Demonstrations do not need a paid AI call or family information sent to a provider.
export default async function handler(req,res) {
  if (!prepare(req,res) || !readBody(req,res)) return;
  const user=await authorize(req,res);
  if (!user || !withinRateLimit(user.id,res)) return;
  return res.status(200).json({
    icon:'shield-check',
    text:'Sample: blocked a fake support pop-up',
    tag:'stopped',
    detail_why:'A sample message used urgency to persuade someone to call an unfamiliar support number.',
    detail_did:'In this demonstration, Proteva would block the suspicious page. No real device action was taken.',
    detail_actions:'No action is needed for this sample. For a real message, contact the company through a channel you already trust.'
  });
}
