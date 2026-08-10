// Vercel Serverless Function: /api/check-scam
// Securely calls the Anthropic API using the key stored in Vercel env vars.
// The secret key NEVER reaches the browser.

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured with an API key.' });
  }

  try {
    // Read the message the user pasted
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const message = (body && body.message ? String(body.message) : '').slice(0, 4000);

    if (!message || message.trim().length < 3) {
      return res.status(400).json({ error: 'Please provide a message to check.' });
    }

    const prompt =
      'You are Proteva, a warm, trustworthy assistant that helps protect elderly people and their families from digital scams. ' +
      'Analyze the following message that someone received and decide whether it is likely a scam.\n\n' +
      'Message:\n"""' + message + '"""\n\n' +
      'Respond ONLY with a JSON object (no markdown, no backticks) in exactly this format:\n' +
      '{"verdict":"danger" or "caution" or "safe","headline":"a short plain-language verdict, max 10 words",' +
      '"why":"2-3 short sentences in simple, warm, senior-friendly language explaining the signs you noticed",' +
      '"whatToDo":"2-3 short sentences of clear, calm advice on what to do next"}\n\n' +
      'Guidance: danger = almost certainly a scam. caution = suspicious or needs care. safe = looks legitimate, no scam signs. ' +
      'Be reassuring, never alarming. Avoid jargon. Speak as if to a kind grandparent.';

    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      return res.status(502).json({ error: 'AI service error', detail: errText.slice(0, 500) });
    }

    const data = await aiResp.json();
    const text = (data.content || [])
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('')
      .trim();

    return res.status(200).json({ text: text });
  } catch (err) {
    return res.status(500).json({ error: 'Something went wrong.', detail: String(err).slice(0, 300) });
  }
}
