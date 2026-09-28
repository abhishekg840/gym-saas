import { NextResponse } from 'next/server';
import { sendWhatsAppNotification } from '@/lib/whatsapp';

export async function POST(req: Request) {
  try {
    const { name, phone, timestamp } = await req.json();

    const message = `Welcome to the floor, ${name}! 💪\n\nCheck-in confirmed at ${timestamp}.\nCrush your session today and remember to hydrate! 🏋️‍♂️`;

    const result = await sendWhatsAppNotification({ phone, message });
    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}