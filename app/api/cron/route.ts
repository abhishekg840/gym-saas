import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Find all expired or expiring members today
    const { data: expiringMembers, error } = await supabase
      .from('members')
      .select('id, full_name, phone, membership_end')
      .lte('membership_end', today);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Auto mark status to expired
    if (expiringMembers && expiringMembers.length > 0) {
      const ids = expiringMembers.map(m => m.id);
      await supabase
        .from('members')
        .update({ status: 'expired' })
        .in('id', ids);
    }

    return NextResponse.json({
      success: true,
      count: expiringMembers?.length || 0,
      checked_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}