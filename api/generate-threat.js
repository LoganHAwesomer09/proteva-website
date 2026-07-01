module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'OpenAI API key not configured on server' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const personName = body.personName || 'your loved one';
  const device = body.device || 'their device';

  const systemPrompt = `You generate realistic digital threats that Proteva (a dignity-first elder protection app) detects and handles on a family member's device.

Return ONLY valid JSON with these exact keys:
- icon: one relevant emoji
- text: short past-tense headline (max 12 words), e.g. "Blocked a fake Microsoft support pop-up"
- tag: "stopped" (Proteva handled it fully) or "attention" (rare — needs caregiver follow-up; use ~15% of the time)
- detail_why: plain-language explanation of what happened and why it's dangerous (2-3 sentences, for caregivers)
- detail_did: what Proteva did automatically (1-2 sentences, calm and confident)
- detail_actions: what the caregiver can do — usually "No action needed" for stopped; clear next steps for attention

Threat types: scam pop-ups, phishing texts/emails, fake bank alerts, IRS/government scams, remote-access attempts, predatory apps, suspicious permissions, unfamiliar logins.

Tone: warm, plain English, never alarmist. No jargon.`;

  const userPrompt = `Generate one new threat Proteva caught on ${personName}'s ${device}. Make it specific and believable. Do not repeat generic examples verbatim.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.9,
        max_tokens: 500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI error:', response.status, errText);
      return res.status(502).json({ error: 'OpenAI request failed' });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: 'Empty OpenAI response' });

    const threat = JSON.parse(content);
    const required = ['icon', 'text', 'tag', 'detail_why', 'detail_did', 'detail_actions'];
    for (const key of required) {
      if (!threat[key]) return res.status(502).json({ error: 'Invalid threat shape from OpenAI' });
    }
    if (threat.tag !== 'stopped' && threat.tag !== 'attention') {
      threat.tag = 'stopped';
    }

    return res.status(200).json(threat);
  } catch (err) {
    console.error('generate-threat error:', err);
    return res.status(500).json({ error: 'Failed to generate threat' });
  }
};
