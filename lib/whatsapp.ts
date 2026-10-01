// Reusable WhatsApp Message Dispatcher
//
// Two ways to reach a member:
//  * sendWhatsAppNotification() — fire through the optional gateway webhook
//    (WHATSAPP_GATEWAY_URL), falling back to the direct wa.me link.
//  * waLink()/message templates below — build a `https://wa.me/{phone}?text=…`
//    deep link for a button (Module 9.2: welcome + gate pass, expiry reminder,
//    payment receipt). These are pure functions so both the console and the
//    member app compose messages the same way.

interface SendMessageOptions {
  phone: string;
  message: string;
}

/** Digits only; 10-digit Indian numbers get the +91 prefix the gateway needs. */
export function waRecipient(phone: string): string {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  return cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
}

/** Direct deep link: opens a chat with the message pre-filled. */
export function waLink(phone: string, message: string): string {
  return `https://wa.me/${waRecipient(phone)}?text=${encodeURIComponent(message)}`;
}

/**
 * The three conversations the gym sends on repeat (Module 9.2). Each returns a
 * plain sentence so a caller can hand it to the gateway OR wrap it in waLink.
 */
export const waMessages = {
  /**
   * Welcome after enrolment. `passUrl` should be a link that opens the
   * member's gate pass (deep link to the member app or the pass page).
   */
  welcome(input: { name: string; gymName: string; passUrl: string; expiry?: string | null }): string {
    const lines = [
      `Hey ${input.name}! 👋`,
      '',
      `Welcome to ${input.gymName}. You're officially in! 🎉`,
      '',
      'Your digital gate pass (show it at the turnstile):',
      input.passUrl,
    ];
    if (input.expiry) lines.push('', `Membership valid until: ${input.expiry}.`);
    lines.push('', 'See you on the floor! 💪');
    return lines.join('\n');
  },

  /** 3-days-before AND on-the-day expiry reminder (driven by /api/cron/whatsapp). */
  expiry(input: { name: string; gymName: string; endDate: string; daysLeft: number; renewUrl?: string }): string {
    const when =
      input.daysLeft <= 0
        ? 'expires *today*'
        : input.daysLeft === 1
          ? 'expires in *1 day*'
          : `expires in *${input.daysLeft} days*`;
    const lines = [
      `Hey ${input.name}! 👋`,
      '',
      `Your membership at ${input.gymName} ${when} (${input.endDate}).`,
      'Renew at the front desk to keep your gate access uninterrupted.',
    ];
    if (input.renewUrl) lines.push('', `Quick renew: ${input.renewUrl}`);
    lines.push('', 'Keep moving! 💪');
    return lines.join('\n');
  },

  /** POS / invoice confirmation with the transaction reference. */
  receipt(input: {
    name: string;
    gymName: string;
    amount: number;
    reference: string;
    items?: string | null;
    invoiceUrl?: string | null;
  }): string {
    const amount = `₹${Number(input.amount || 0).toLocaleString('en-IN')}`;
    const lines = [
      `Hi ${input.name}, thanks for your payment! 🧾`,
      '',
      `Gym: ${input.gymName}`,
      `Amount: ${amount}`,
      `Reference: ${input.reference}`,
    ];
    if (input.items) lines.push(`Items: ${input.items}`);
    if (input.invoiceUrl) lines.push('', `View / download your invoice: ${input.invoiceUrl}`);
    lines.push('', 'Train hard! 🏋️');
    return lines.join('\n');
  },
};

export async function sendWhatsAppNotification({ phone, message }: SendMessageOptions) {
  const recipient = waRecipient(phone);

  // Agar aapne koi WhatsApp Gateway (Baileys/WPPConnect/Evolution) setup kiya hai
  const webhookUrl = process.env.WHATSAPP_GATEWAY_URL;

  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: recipient,
          message: message,
        }),
      });
      return await res.json();
    } catch (err) {
      console.error('WhatsApp Gateway Error:', err);
    }
  }

  // Fallback direct link format
  const encodedText = encodeURIComponent(message);
  return {
    success: true,
    directUrl: `https://wa.me/${recipient}?text=${encodedText}`,
  };
}