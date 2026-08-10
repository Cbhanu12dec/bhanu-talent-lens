// Builds an RFC 2822 MIME message (body + one attachment) and creates it
// as a Gmail draft via the Gmail API. Requires an access token with the
// gmail.compose scope (requested during Google sign-in — see firebase.js).

function encodeSubject(subject) {
  // Encoded-word form so non-ASCII subjects survive intact.
  const b64 = btoa(unescape(encodeURIComponent(subject)));
  return `=?UTF-8?B?${b64}?=`;
}

function toBase64Url(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildRawMime({ from, to, subject, body, attachment }) {
  const boundary = 'resumecraftpro_' + Math.random().toString(36).slice(2);
  const parts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    body,
    ''
  ];

  if (attachment) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      attachment.base64,
      ''
    );
  }
  parts.push(`--${boundary}--`);
  return parts.join('\r\n');
}

export async function createGmailDraft({ accessToken, from, to, subject, body, attachment }) {
  const raw = toBase64Url(buildRawMime({ from, to, subject, body, attachment }));

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message: { raw } })
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gmail API error ${res.status}: ${errBody}`);
  }
  return res.json(); // includes draft id — visible in the user's Gmail drafts folder
}
