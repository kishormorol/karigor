/** Sends the one-time sign-in email. Through Resend when RESEND_API_KEY and KARIGOR_MAIL_FROM are set. */
export type Mailer = (to: string, link: string, lang: "en" | "bn") => Promise<{ ok: boolean; output: string }>;

const WORDS = {
  en: { subject: "Your Karigor sign-in link", text: (l: string) => `Open this link to sign in to Karigor:\n\n${l}\n\nIt works once, for 15 minutes. If you did not ask for it, ignore this email.` },
  bn: { subject: "আপনার Karigor সাইন ইন লিংক", text: (l: string) => `Karigor-এ সাইন ইন করতে এই লিংকটি খুলুন:\n\n${l}\n\nএটি একবার, ১৫ মিনিটের জন্য কাজ করে। আপনি না চেয়ে থাকলে এই ইমেইলটি এড়িয়ে যান।` },
};

export function resendMailer(o: { apiKey: string; from: string; fetchImpl?: typeof fetch }): Mailer {
  return async (to, link, lang) => {
    const w = WORDS[lang];
    try {
      const res = await (o.fetchImpl ?? fetch)("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: o.from, to: [to], subject: w.subject, text: w.text(link) }),
        signal: AbortSignal.timeout(20_000),
      });
      return { ok: res.ok, output: res.ok ? "sent" : `Resend said ${res.status}` };
    } catch (e) {
      return { ok: false, output: (e as Error).message };
    }
  };
}

/** Without an email service (a Karigor for a few people): the link goes to the server's log for whoever runs it to pass on. */
export function logMailer(log: (line: string) => void): Mailer {
  return async (to, link) => {
    log(`sign-in link for ${to} (no email service set up, so pass it on yourself): ${link}`);
    return { ok: true, output: "logged" };
  };
}
