// Reusable WhatsApp Message Dispatcher

interface SendMessageOptions {
  phone: string;
  message: string;
}

export async function sendWhatsAppNotification({ phone, message }: SendMessageOptions) {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const recipient = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

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