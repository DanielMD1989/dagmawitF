import { env } from './env';

interface Summary {
  ID: string;
  Created: string;
  To: { Address: string }[];
}

/**
 * The sign-in code sent to `email` after `since`, read from Mailpit, the mail catcher of the local Supabase stack.
 * GoTrue sends our HTML template (supabase/templates/magic_link.html); the code follows "Your sign-in code is:".
 */
export async function signInCode(email: string, since: Date, timeoutMs = 15_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const list = (await (await fetch(`${env.mailpitUrl}/api/v1/messages`)).json()) as { messages: Summary[] };
    const found = list.messages.find(
      (m) =>
        m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()) &&
        Date.parse(m.Created) >= since.getTime() - 1000,
    );
    if (found) {
      const message = (await (await fetch(`${env.mailpitUrl}/api/v1/message/${found.ID}`)).json()) as {
        Text?: string;
        HTML?: string;
      };
      const words = `${message.Text ?? ''} ${(message.HTML ?? '').replace(/<[^>]+>/g, ' ')}`.replace(
        /\s+/g,
        ' ',
      );
      const code = /sign-in code is:?\s*(\d{6})/.exec(words)?.[1];
      if (code) return code;
      throw new Error(`The sign-in email has no code: ${words.slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  // Say what the mailbox did hold: nothing at all points at the auth server, mail for others at the address.
  const list = (await (await fetch(`${env.mailpitUrl}/api/v1/messages`)).json()) as { messages: Summary[] };
  const held = list.messages.map((m) => `${m.Created} to ${m.To.map((t) => t.Address).join(', ')}`);
  throw new Error(
    `No sign-in email reached ${email} in Mailpit (${env.mailpitUrl}) since ${since.toISOString()}. ` +
      (held.length === 0
        ? 'The mailbox is empty: the code was never sent.'
        : `It holds: ${held.join('; ')}.`),
  );
}
