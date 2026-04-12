import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
    if (!token) return new Response(JSON.stringify({ error: 'No token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: { user }, error: userErr } = await adminClient.auth.getUser(token);
    if (userErr || !user) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: profile } = await adminClient.from('profiles').select('shop_id, role').eq('id', user.id).single();

    if (!profile) {
      await adminClient.auth.admin.deleteUser(user.id);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const isAdmin = profile.role === 'Admin';
    const shopId  = profile.shop_id;

    if (isAdmin && shopId) {
      const { data: pos } = await adminClient.from('purchase_orders').select('id').eq('shop_id', shopId);
      const poIds = (pos || []).map((p) => p.id);
      if (poIds.length) await adminClient.from('purchase_order_items').delete().in('po_id', poIds);

      const { data: wos } = await adminClient.from('work_orders').select('id').eq('shop_id', shopId);
      const woIds = (wos || []).map((w) => w.id);
      if (woIds.length) {
        await adminClient.from('work_order_parts').delete().in('work_order_id', woIds);
        await adminClient.from('wo_status_history').delete().in('work_order_id', woIds);
      }

      const { data: invs } = await adminClient.from('invoices').select('id').eq('shop_id', shopId);
      const invIds = (invs || []).map((i) => i.id);
      if (invIds.length) await adminClient.from('invoice_payments').delete().in('invoice_id', invIds);

      await adminClient.from('work_orders').delete().eq('shop_id', shopId);
      await adminClient.from('invoices').delete().eq('shop_id', shopId);
      await adminClient.from('appointments').delete().eq('shop_id', shopId);

      const { data: custs } = await adminClient.from('customers').select('id').eq('shop_id', shopId);
      const custIds = (custs || []).map((c) => c.id);
      if (custIds.length) await adminClient.from('vehicles').delete().in('customer_id', custIds);

      await adminClient.from('customers').delete().eq('shop_id', shopId);
      await adminClient.from('purchase_orders').delete().eq('shop_id', shopId);
      await adminClient.from('inventory').delete().eq('shop_id', shopId);
      await adminClient.from('suppliers').delete().eq('shop_id', shopId);
      await adminClient.from('notifications').delete().eq('shop_id', shopId);
      await adminClient.from('staff_invites').delete().eq('shop_id', shopId);
      await adminClient.from('billing_transactions').delete().eq('shop_id', shopId);
      await adminClient.from('subscriptions').delete().eq('shop_id', shopId);
      await adminClient.from('shop_settings').delete().eq('shop_id', shopId);
      await adminClient.from('profiles').delete().eq('shop_id', shopId);

      const { error: shopErr } = await adminClient.from('shops').delete().eq('id', shopId);
      if (shopErr) return new Response(JSON.stringify({ error: 'Failed to delete shop: ' + shopErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else {
      await adminClient.from('profiles').delete().eq('id', user.id);
    }

    await adminClient.auth.admin.deleteUser(user.id);
    return new Response(JSON.stringify({ success: true, message: 'Account permanently deleted' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal server error: ' + err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
