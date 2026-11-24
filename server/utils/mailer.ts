// Sends email through Resend's HTTP API. Used only when RESEND_API_KEY and EMAIL_FROM are set (until then every email feature is off).
// `fetchImpl` is injectable so tests never reach a real provider. Nothing here logs an address, a key or a message body.
import type { Env, Mailer } from "./authConfig";

export function resendMailer(env: Env, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    async send({ to, subject, text }) {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
      });
      if (!res.ok) throw new Error(`email provider answered ${res.status}`);
    },
  };
}
