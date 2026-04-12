/* =================================================================
   GEARSHIFT — SUPABASE.JS
   Multi-tenant data layer — every query is scoped to the
   current user's shop_id so shops never see each other's data.

   HOW TO USE:
   1. Create a free project at https://supabase.com
   2. Run supabase_schema.sql in SQL Editor
   3. Copy your Project URL + anon key below
   4. In every HTML page replace data.js with:
        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
        <script src="../js/supabase.js"></script>
   ================================================================= */

/* -----------------------------------------------------------------
   ⚙️  CONFIGURATION — replace these two values
   ----------------------------------------------------------------- */
const SUPABASE_URL  = 'https://tqwwnmgcvaqeigpodirc.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxd3dubWdjdmFxZWlncG9kaXJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0Nzg5ODEsImV4cCI6MjA4ODA1NDk4MX0.mP5RNZ0Tu7ckrDkjCmrVcbnaMJ2Sf7QfuGCslElGLo0';

/* -----------------------------------------------------------------
   CLIENT  (global `sb`)
   ----------------------------------------------------------------- */
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: true,
  },
});

/* =================================================================
   SHOP CONTEXT  — cached shop_id for the current session.
   Every GS query calls _shopId() to scope its results.
   Cache is cleared on sign-out so switching accounts works cleanly.
   ================================================================= */
let _cachedShopId = null;

async function _shopId() {
  if (_cachedShopId) return _cachedShopId;

  const { data: { user: authUser } } = await sb.auth.getUser();
  if (!authUser) throw new Error('Not authenticated');

  const { data: rows, error } = await sb.from('profiles')
    .select('shop_id')
    .eq('id', authUser.id)
    .limit(1);

  if (error || !rows?.length) throw new Error('Could not resolve shop for current user');

  const shopId = rows[0].shop_id;
  if (!shopId) throw new Error('Your account is not linked to a shop yet. Please complete registration.');

  _cachedShopId = shopId;
  return _cachedShopId;
}

function _clearShopCache() {
  _cachedShopId = null;
}

/* =================================================================
   AUTH MODULE
   ================================================================= */
const Auth = (() => {

  async function signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    _clearShopCache();
    return data;
  }

  async function signInWithGoogle() {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href.split('?')[0] }
    });
    if (error) throw error;
  }

  async function signUp(email, password, fullName, role) {
    if (!role) throw new Error('Role is required to create an account.');
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name: fullName, role } }
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    _clearShopCache();
    await sb.auth.signOut();
  }

  async function getSession() {
    const { data: { session } } = await sb.auth.getSession();
    return session;
  }

  async function getUser() {
    const session = await getSession();
    if (!session) return null;

    const { data: rows, error } = await sb.from('profiles')
      .select('id, full_name, role, email, shop_id, avatar_url, speciality')
      .eq('id', session.user.id)
      .limit(1);

    const profile = rows?.[0] || null;
    if (error || !profile) {
      return {
        id: session.user.id,
        full_name: session.user.user_metadata?.full_name || session.user.email.split('@')[0],
        role: session.user.user_metadata?.role || 'Admin',
        shop_id: null,
        email: session.user.email,
      };
    }

    if (profile.shop_id) {
      _cachedShopId = profile.shop_id; // prime cache
      const { data: shop } = await sb.from('shops')
        .select('name').eq('id', profile.shop_id).single();
      profile.shop_name = shop?.name || null;
    }

    return profile;
  }

  async function resetPassword(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.href.split('?')[0] + '?reset=1'
    });
    if (error) throw error;
  }

  async function requireAuth() {
    const session = await getSession();
    if (!session) window.location.href = '../app/dashboard.html';
    return session;
  }

  async function requireRole(...roles) {
    const user = await getUser();
    if (!user || !roles.includes(user.role)) {
      Toast.show(`Access denied. Required role: ${roles.join(' or ')}`, 'error');
      return false;
    }
    return user;
  }

  function onAuthChange(callback) {
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') _clearShopCache();
      callback(event, session);
    });
  }

  return {
    signIn, signInWithGoogle, signUp, signOut,
    getSession, getUser, resetPassword,
    requireAuth, requireRole, onAuthChange,
  };
})();

/* =================================================================
   REALTIME MODULE — subscriptions filtered to current shop
   ================================================================= */
const Realtime = (() => {
  const channels = {};

  async function subscribe(table, { onInsert, onUpdate, onDelete } = {}) {
    const name = `realtime:${table}:${Date.now()}`;

    let shopFilter = null;
    try {
      const sid = await _shopId();
      if (sid) shopFilter = `shop_id=eq.${sid}`;
    } catch(e) { /* no shop yet — RLS will cover us */ }

    const baseOpts = shopFilter
      ? { schema: 'public', table, filter: shopFilter }
      : { schema: 'public', table };

    const channel = sb.channel(name)
      .on('postgres_changes', { event: 'INSERT', ...baseOpts }, p => { if (onInsert) onInsert(p.new); })
      .on('postgres_changes', { event: 'UPDATE', ...baseOpts }, p => { if (onUpdate) onUpdate(p.new, p.old); })
      .on('postgres_changes', { event: 'DELETE', ...baseOpts }, p => { if (onDelete) onDelete(p.old); })
      .subscribe();

    channels[name] = channel;
    return name;
  }

  function unsubscribe(name) {
    if (channels[name]) { sb.removeChannel(channels[name]); delete channels[name]; }
  }

  function unsubscribeAll() { Object.keys(channels).forEach(unsubscribe); }

  return { subscribe, unsubscribe, unsubscribeAll };
})();

/* =================================================================
   FORMAT HELPER  (used by getDashboardKPIs)
   ================================================================= */
function formatCurrency(amount) {
  return '\u20a6' + Number(amount || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/* =================================================================
   DATA MODULE  — every read filtered by shop_id,
                  every write injects shop_id
   ================================================================= */
const GS = (() => {

  /* ---------------------------------------------------------------
     CUSTOMERS
     --------------------------------------------------------------- */
  async function getCustomers() {
    const sid = await _shopId();
    const { data, error } = await sb.from('customers')
      .select('*').eq('shop_id', sid).order('last_name');
    if (error) throw error;
    return data;
  }

  async function getCustomer(id) {
    const sid = await _shopId();
    const { data, error } = await sb.from('customers')
      .select('*, vehicles(*)')
      .eq('id', id).eq('shop_id', sid).single();
    if (error) throw error;
    return data;
  }

  async function createCustomer(payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('customers')
      .insert({ ...payload, shop_id: sid }).select().single();
    if (error) throw error;
    return data;
  }

  async function updateCustomer(id, payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('customers')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id).eq('shop_id', sid).select();
    if (error) throw error;
    try {
      const { data: { session } } = await sb.auth.getSession();
      await sb.from('audit_logs').insert({
        table_name: 'customers', record_id: id, action: 'UPDATE',
        changed_by: session?.user?.id || null, changes: JSON.stringify(payload),
      });
    } catch(e) { console.warn('Audit log failed:', e); }
    return data?.[0];
  }

  async function deleteCustomer(id) {
    const sid = await _shopId();
    try {
      const { data: { session } } = await sb.auth.getSession();
      await sb.from('audit_logs').insert({
        table_name: 'customers', record_id: id, action: 'DELETE',
        changed_by: session?.user?.id || null, changes: null,
      });
    } catch(e) {}
    const { error } = await sb.from('customers')
      .delete().eq('id', id).eq('shop_id', sid);
    if (error) throw error;
  }

  async function getAuditLog(tableName, recordId) {
    const { data, error } = await sb.from('audit_logs')
      .select('id, action, changes, created_at, changed_by')
      .eq('table_name', tableName).eq('record_id', recordId)
      .order('created_at', { ascending: false }).limit(20);
    if (error) return [];
    const rows = data || [];
    const userIds = [...new Set(rows.filter(r => r.changed_by).map(r => r.changed_by))];
    let nameMap = {};
    if (userIds.length) {
      const { data: profiles } = await sb.from('profiles').select('id, full_name').in('id', userIds);
      (profiles || []).forEach(p => { nameMap[p.id] = p.full_name; });
    }
    return rows.map(r => ({ ...r, changer_name: nameMap[r.changed_by] || 'Unknown' }));
  }

  /* ---------------------------------------------------------------
     VEHICLES  (belong to customers who belong to the shop)
     --------------------------------------------------------------- */
  async function getVehicles(customerId = null) {
    const sid = await _shopId();
    // Join through customers to scope to this shop
    let q = sb.from('vehicles')
      .select('*, customers!inner(id, first_name, last_name, shop_id)')
      .eq('customers.shop_id', sid)
      .order('year', { ascending: false });
    if (customerId) q = q.eq('customer_id', customerId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async function createVehicle(payload) {
    const { data, error } = await sb.from('vehicles').insert(payload).select();
    if (error) throw error;
    try {
      const { data: { session } } = await sb.auth.getSession();
      await sb.from('audit_logs').insert({
        table_name: 'vehicles', record_id: data?.[0]?.id,
        action: 'CREATE', changed_by: session?.user?.id || null, changes: null,
      });
    } catch(e) {}
    return data?.[0];
  }

  async function updateVehicle(id, payload) {
    const { data, error } = await sb.from('vehicles')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id).select();
    if (error) throw error;
    try {
      const { data: { session } } = await sb.auth.getSession();
      await sb.from('audit_logs').insert({
        table_name: 'vehicles', record_id: id, action: 'UPDATE',
        changed_by: session?.user?.id || null, changes: JSON.stringify(payload),
      });
    } catch(e) { console.warn('Audit log failed:', e); }
    return data?.[0];
  }

  async function deleteVehicle(id) {
    try {
      const { data: { session } } = await sb.auth.getSession();
      await sb.from('audit_logs').insert({
        table_name: 'vehicles', record_id: id, action: 'DELETE',
        changed_by: session?.user?.id || null, changes: null,
      });
    } catch(e) {}
    const { error } = await sb.from('vehicles').delete().eq('id', id);
    if (error) throw error;
  }

  /* ---------------------------------------------------------------
     WORK ORDERS
     --------------------------------------------------------------- */
  async function getWorkOrders(filters = {}) {
    const sid = await _shopId();
    let q = sb.from('work_orders')
      .select('*').eq('shop_id', sid)
      .order('created_at', { ascending: false });
    if (filters.status)      q = q.eq('status', filters.status);
    if (filters.mechanic_id) q = q.eq('mechanic_id', filters.mechanic_id);
    if (filters.customer_id) q = q.eq('customer_id', filters.customer_id);
    const { data, error } = await q;
    if (error) throw error;

    const wos     = data || [];
    const custIds = [...new Set(wos.map(w => w.customer_id).filter(Boolean))];
    const vehIds  = [...new Set(wos.map(w => w.vehicle_id).filter(Boolean))];
    const mechIds = [...new Set(wos.map(w => w.mechanic_id).filter(Boolean))];
    const [custs, vehs, mechs] = await Promise.all([
      custIds.length ? sb.from('customers').select('id,first_name,last_name').in('id', custIds) : { data: [] },
      vehIds.length  ? sb.from('vehicles').select('id,year,make,model').in('id', vehIds)        : { data: [] },
      mechIds.length ? sb.from('profiles').select('id,full_name').in('id', mechIds)             : { data: [] },
    ]);
    const custMap = Object.fromEntries((custs.data||[]).map(c => [c.id, `${c.first_name} ${c.last_name}`]));
    const vehMap  = Object.fromEntries((vehs.data||[]).map(v => [v.id, `${v.year||''} ${v.make} ${v.model}`.trim()]));
    const mechMap = Object.fromEntries((mechs.data||[]).map(m => [m.id, m.full_name]));
    return wos.map(w => ({
      ...w,
      customer_name: custMap[w.customer_id] || '—',
      vehicle_label: vehMap[w.vehicle_id]   || '—',
      mechanic_name: mechMap[w.mechanic_id] || null,
    }));
  }

  async function getWorkOrder(id) {
    const sid = await _shopId();
    const { data: woRows, error: woErr } = await sb.from('work_orders')
      .select('*').eq('id', id).eq('shop_id', sid).limit(1);
    if (woErr) throw woErr;
    const wo = woRows?.[0];
    if (!wo) throw new Error('Work order not found');

    const [custRes, vehRes, mechRes, partsRes] = await Promise.all([
      wo.customer_id ? sb.from('customers').select('id,first_name,last_name').eq('id', wo.customer_id).limit(1) : { data: [] },
      wo.vehicle_id  ? sb.from('vehicles').select('id,year,make,model,vin,plate,mileage').eq('id', wo.vehicle_id).limit(1) : { data: [] },
      wo.mechanic_id ? sb.from('profiles').select('id,full_name').eq('id', wo.mechanic_id).limit(1) : { data: [] },
      sb.from('work_order_parts').select('id,qty,unit_cost,part_id').eq('work_order_id', id),
    ]);
    const cust  = custRes.data?.[0];
    const veh   = vehRes.data?.[0];
    const mech  = mechRes.data?.[0];
    const parts = partsRes.data || [];
    const partIds = parts.map(p => p.part_id).filter(Boolean);
    let invMap = {};
    if (partIds.length) {
      const { data: inv } = await sb.from('inventory').select('id,name,sku,cost').in('id', partIds);
      (inv||[]).forEach(i => { invMap[i.id] = i; });
    }
    return {
      ...wo,
      customer_name: cust ? `${cust.first_name} ${cust.last_name}` : '—',
      vehicle_label: veh  ? `${veh.year||''} ${veh.make} ${veh.model}`.trim() : '—',
      vehicle:       veh  || null,
      mechanic_name: mech?.full_name || null,
      parts: parts.map(p => ({ ...p, inventory: invMap[p.part_id] || null })),
    };
  }

  async function createWorkOrder(payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('work_orders')
      .insert({ ...payload, shop_id: sid, status: 'Open', ref: '' }).select();
    if (error) throw error;
    const wo = data?.[0];
    if (wo && payload.mechanic_id) {
      try {
        const [custRes, vehRes] = await Promise.all([
          payload.customer_id ? sb.from('customers').select('first_name,last_name').eq('id', payload.customer_id).single() : { data: null },
          payload.vehicle_id  ? sb.from('vehicles').select('year,make,model').eq('id', payload.vehicle_id).single()        : { data: null },
        ]);
        const custName = custRes.data ? custRes.data.first_name + ' ' + custRes.data.last_name : 'a customer';
        const vehLabel = vehRes.data  ? ((vehRes.data.year||'') + ' ' + vehRes.data.make + ' ' + vehRes.data.model).trim() : 'a vehicle';
        await createNotification({
          type: 'wo_update',
          title: 'New Work Order Assigned -- ' + (wo.ref || ''),
          body: 'You have been assigned a new job. Customer: ' + custName + '. Vehicle: ' + vehLabel + '. Fault: ' + (payload.fault || 'See work order') + '.',
          related_id: wo.id, related_type: 'work_order',
          for_user_id: payload.mechanic_id,
        });
      } catch(e) { console.warn('WO assignment notification failed:', e.message); }
    }
    return wo;
  }

  async function updateWorkOrder(id, payload) {
    const sid = await _shopId();
    const now  = new Date().toISOString();
    const update = { ...payload, updated_at: now };
    if (payload.status) update.status_changed_at = now;

    const { data, error } = await sb.from('work_orders')
      .update(update).eq('id', id).eq('shop_id', sid).select();
    if (error) throw error;
    const wo = data?.[0];

    if (payload.status) {
      try {
        const { data: { session } } = await sb.auth.getSession();
        await sb.from('wo_status_history').insert({
          work_order_id: id, status: payload.status,
          changed_by: session?.user?.id || null, changed_at: now,
        });
      } catch(e) { console.warn('Status history write failed:', e); }

      try {
        const statusLabels = {
          'In Progress':    'Work has started on your vehicle',
          'Awaiting Parts': 'We are waiting on parts for your vehicle',
          'Completed':      'Your vehicle repair has been completed',
          'Cancelled':      'Your work order has been cancelled',
        };
        const body = statusLabels[payload.status];
        if (body) {
          await createNotification({
            type: 'wo_update',
            title: `Work Order ${wo?.ref || id} — ${payload.status}`,
            body, related_id: id, related_type: 'work_order',
          });
        }
      } catch(e) { console.warn('Status notification failed:', e); }
    }
    return wo;
  }

  async function getWOStatusHistory(workOrderId) {
    const { data, error } = await sb.from('wo_status_history')
      .select('id, status, changed_at, changed_by')
      .eq('work_order_id', workOrderId)
      .order('changed_at', { ascending: true });
    if (error) return [];
    const rows = data || [];
    const userIds = [...new Set(rows.filter(r => r.changed_by).map(r => r.changed_by))];
    let nameMap = {};
    if (userIds.length) {
      const { data: profiles } = await sb.from('profiles').select('id,full_name').in('id', userIds);
      (profiles||[]).forEach(p => { nameMap[p.id] = p.full_name; });
    }
    return rows.map(r => ({ ...r, changer_name: nameMap[r.changed_by] || 'Unknown' }));
  }

  async function addPartToWorkOrder(workOrderId, partId, qty, unitCost) {
    const { data, error } = await sb.from('work_order_parts')
      .insert({ work_order_id: workOrderId, part_id: partId, qty, unit_cost: unitCost })
      .select().single();
    if (error) throw error;
    return data;
  }

  async function removePartFromWorkOrder(workOrderId, partId) {
    const { error } = await sb.from('work_order_parts')
      .delete().eq('work_order_id', workOrderId).eq('part_id', partId);
    if (error) throw error;
  }

  // Returns ALL work_order_parts for this shop — used by reports/turnover
  async function getAllWorkOrderParts() {
    const sid = await _shopId();
    const { data: woRows, error: woErr } = await sb.from('work_orders')
      .select('id, created_at').eq('shop_id', sid);
    if (woErr) throw woErr;
    if (!woRows?.length) return [];
    const woIds = woRows.map(w => w.id);
    const woDateMap = Object.fromEntries(woRows.map(w => [w.id, w.created_at]));
    const { data, error } = await sb.from('work_order_parts')
      .select('work_order_id, part_id, qty, unit_cost')
      .in('work_order_id', woIds);
    if (error) throw error;
    // Attach the WO date so reports can filter by date range
    return (data || []).map(p => ({ ...p, wo_date: woDateMap[p.work_order_id] || null }));
  }

  /* ---------------------------------------------------------------
     INVENTORY
     --------------------------------------------------------------- */
  async function getInventory(filters = {}) {
    const sid = await _shopId();
    let q = sb.from('inventory').select('*').eq('shop_id', sid).order('name');
    if (filters.category) q = q.eq('category', filters.category);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(item => ({
      ...item,
      stock_status: item.qty <= 0
        ? 'Out of Stock'
        : item.qty <= (item.threshold || 0) ? 'Low Stock' : 'In Stock',
    }));
  }

  async function getInventoryItem(id) {
    const sid = await _shopId();
    const { data, error } = await sb.from('inventory')
      .select('*').eq('id', id).eq('shop_id', sid).single();
    if (error) throw error;
    return data;
  }

  async function createInventoryItem(payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('inventory')
      .insert({ ...payload, shop_id: sid }).select().single();
    if (error) throw error;
    return data;
  }

  async function updateInventoryItem(id, payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('inventory')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id).eq('shop_id', sid).select().single();
    if (error) throw error;
    return data;
  }

  async function adjustStock(id, delta, reason = '') {
    const { data, error } = await sb.rpc('adjust_inventory_qty', {
      p_part_id: id, p_delta: delta, p_reason: reason,
    });
    if (error) throw error;
    return data;
  }

  async function getLowStockItems() {
    const sid = await _shopId();
    const { data, error } = await sb.from('inventory')
      .select('*').eq('shop_id', sid).order('qty');
    if (error) throw error;
    return (data || []).filter(item => item.qty <= (item.threshold || 0));
  }

  /* ---------------------------------------------------------------
     SUPPLIERS
     --------------------------------------------------------------- */
  async function getSuppliers() {
    const sid = await _shopId();
    const { data, error } = await sb.from('suppliers')
      .select('*').eq('shop_id', sid).order('name');
    if (error) throw error;
    return data;
  }

  async function createSupplier(payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('suppliers')
      .insert({ ...payload, shop_id: sid }).select().single();
    if (error) throw error;
    return data;
  }

  async function updateSupplier(id, payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('suppliers')
      .update(payload).eq('id', id).eq('shop_id', sid).select().single();
    if (error) throw error;
    return data;
  }

  /* ---------------------------------------------------------------
     PURCHASE ORDERS
     --------------------------------------------------------------- */
  async function getPurchaseOrders() {
    const sid = await _shopId();
    const { data, error } = await sb.from('purchase_orders')
      .select('*, suppliers(name), purchase_order_items(*, inventory:part_id(id,name,sku))')
      .eq('shop_id', sid).order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async function createPurchaseOrder(supplierId, items, notes = '', expectedAt = null) {
    const sid = await _shopId();
    const poPayload = { supplier_id: supplierId, notes: notes || null, ref: '', shop_id: sid };
    if (expectedAt) poPayload.expected_at = expectedAt;

    const { data: po, error: poErr } = await sb.from('purchase_orders')
      .insert(poPayload).select().single();
    if (poErr) throw poErr;

    const poItems = items.map(i => ({
      po_id:     po.id,
      part_id:   i.part_id || i.inventory_id || i.partId,
      qty:       i.qty || i.qty_ordered || 1,
      unit_cost: i.cost ?? i.unitCost ?? 0,
    }));
    const { error: itemErr } = await sb.from('purchase_order_items').insert(poItems);
    if (itemErr) throw itemErr;

    const { data: full } = await sb.from('purchase_orders')
      .select('*, suppliers(name), purchase_order_items(*, inventory:part_id(name,sku))')
      .eq('id', po.id).single();
    return full || po;
  }

  async function updatePOStatus(id, status) {
    const sid = await _shopId();
    const updates = { status, updated_at: new Date().toISOString() };
    if (status === 'Sent') updates.sent_at = new Date().toISOString();
    const { data, error } = await sb.from('purchase_orders')
      .update(updates).eq('id', id).eq('shop_id', sid).select().single();
    if (error) throw error;
    return data;
  }

  async function receivePOItem(poItemId, qtyReceived) {
    const { data, error } = await sb.from('purchase_order_items')
      .update({ qty_received: qtyReceived }).eq('id', poItemId).select().single();
    if (error) throw error;
    return data;
  }

  /* ---------------------------------------------------------------
     INVOICES
     --------------------------------------------------------------- */
  async function getInvoices(filters = {}) {
    const sid = await _shopId();

    // Step 1: get IDs scoped to this shop from the base table
    let baseQ = sb.from('invoices')
      .select('id').eq('shop_id', sid);
    if (filters.status)      baseQ = baseQ.eq('status', filters.status);
    if (filters.customer_id) baseQ = baseQ.eq('customer_id', filters.customer_id);
    const { data: baseRows, error: baseErr } = await baseQ;
    if (baseErr) throw baseErr;
    if (!baseRows?.length) return [];

    // Step 2: query the view (which has customer_name, customer_email, wo_ref, total)
    // filtered to only IDs belonging to this shop
    const ids = baseRows.map(r => r.id);
    const { data, error } = await sb.from('v_invoices')
      .select('*')
      .in('id', ids)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async function createInvoice(payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('invoices')
      .insert({ ...payload, shop_id: sid, ref: '' }).select().single();
    if (error) throw error;
    return data;
  }

  async function markInvoicePaid(id, method = 'Card') {
    const sid = await _shopId();
    const { data, error } = await sb.from('invoices')
      .update({
        status: 'Paid', payment_method: method,
        paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      .eq('id', id).eq('shop_id', sid).select().single();
    if (error) throw error;
    return data;
  }

  async function updateInvoiceStatus(id, status) {
    const sid = await _shopId();
    const { data, error } = await sb.from('invoices')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id).eq('shop_id', sid).select().single();
    if (error) throw error;
    return data;
  }

  /* ---------------------------------------------------------------
     APPOINTMENTS
     --------------------------------------------------------------- */
  async function getAppointments(filters = {}) {
    const sid = await _shopId();

    // Step 1: get base data including guest columns from the base table
    let baseQ = sb.from('appointments')
      .select('id, guest_name, guest_phone, guest_email, vehicle_info, customer_id')
      .eq('shop_id', sid);
    if (filters.upcoming)    baseQ = baseQ.gte('appt_date', new Date().toISOString().split('T')[0]);
    if (filters.mechanic_id) baseQ = baseQ.eq('mechanic_id', filters.mechanic_id);
    const { data: baseRows, error: baseErr } = await baseQ;
    if (baseErr) throw baseErr;
    if (!baseRows?.length) return [];

    // Build a map of id → guest fields for merging
    const guestMap = {};
    baseRows.forEach(r => {
      guestMap[r.id] = {
        guest_name:   r.guest_name,
        guest_phone:  r.guest_phone,
        guest_email:  r.guest_email,
        vehicle_info: r.vehicle_info,
      };
    });

    // Step 2: query the view for enriched data (customer_name, vehicle_label, mechanic_name)
    const ids = baseRows.map(r => r.id);
    const { data, error } = await sb.from('v_appointments')
      .select('*')
      .in('id', ids)
      .order('appt_date').order('appt_time');
    if (error) throw error;

    // Step 3: merge guest fields back in — these aren't in the view
    return (data || []).map(a => ({ ...guestMap[a.id], ...a }));
  }

  async function createAppointment(payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('appointments')
      .insert({ ...payload, shop_id: sid, ref: '' }).select().single();
    if (error) throw error;
    return data;
  }

  async function updateAppointment(id, payload) {
    const sid = await _shopId();
    const { data, error } = await sb.from('appointments')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id).eq('shop_id', sid).select().single();
    if (error) throw error;
    return data;
  }

  async function cancelAppointment(id) {
    return updateAppointment(id, { status: 'Cancelled' });
  }

  /* ---------------------------------------------------------------
     NOTIFICATIONS
     --------------------------------------------------------------- */
  async function createNotification(payload) {
    try {
      const sid = await _shopId();
      const { error } = await sb.from('notifications').insert({
        type:         payload.type         || 'wo_update',
        title:        payload.title,
        body:         payload.body,
        related_id:   payload.related_id   || null,
        related_type: payload.related_type || null,
        for_user_id:  payload.for_user_id  || null,
        shop_id:      sid,
        read:         false,
      });
      if (error) console.warn('Notification insert error:', error);
    } catch(e) { console.warn('createNotification failed:', e); }
  }

  async function getNotifications(unreadOnly = false) {
    const sid = await _shopId();
    const { data: { user: authUser } } = await sb.auth.getUser();
    const uid = authUser?.id || null;
    let q = sb.from('notifications')
      .select('*').eq('shop_id', sid)
      .or('for_user_id.is.null,for_user_id.eq.' + uid)
      .order('created_at', { ascending: false });
    if (unreadOnly) q = q.eq('read', false);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async function getUnreadCount() {
    const sid = await _shopId();
    const { data: { user: authUser } } = await sb.auth.getUser();
    const uid = authUser?.id || null;
    const { count, error } = await sb.from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', sid).eq('read', false)
      .or('for_user_id.is.null,for_user_id.eq.' + uid);
    if (error) return 0;
    return count || 0;
  }

  async function markNotificationRead(id) {
    const sid = await _shopId();
    const { error } = await sb.from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', id).eq('shop_id', sid);
    if (error) throw error;
  }

  async function markAllNotificationsRead() {
    const sid = await _shopId();
    const { error } = await sb.from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('shop_id', sid).eq('read', false);
    if (error) throw error;
  }

  async function deleteNotification(id) {
    const sid = await _shopId();
    const { error } = await sb.from('notifications')
      .delete().eq('id', id).eq('shop_id', sid);
    if (error) throw error;
  }

  async function clearReadNotifications() {
    const sid = await _shopId();
    const { error } = await sb.from('notifications')
      .delete().eq('shop_id', sid).eq('read', true);
    if (error) throw error;
  }

  /* ---------------------------------------------------------------
     DASHBOARD KPIs  — computed directly, always shop-scoped
     --------------------------------------------------------------- */
  async function getDashboardKPIs() {
    const sid   = await _shopId();
    const now   = new Date().toISOString().split('T')[0];
    const month = now.slice(0, 7);

    const [wosRes, invItemsRes, apptRes, invRes, notifRes] = await Promise.allSettled([
      sb.from('work_orders')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', sid)
        .in('status', ['Open', 'In Progress', 'Awaiting Parts']),
      sb.from('inventory')
        .select('id, qty, threshold')
        .eq('shop_id', sid),
      sb.from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', sid)
        .gte('appt_date', now),
      // Use base table — total = labor_amount + parts_amount + tax_amount
      sb.from('invoices')
        .select('labor_amount, parts_amount, tax_amount, paid_at, status')
        .eq('shop_id', sid),
      sb.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', sid)
        .eq('read', false),
    ]);

    const activeWOs     = wosRes.status     === 'fulfilled' ? (wosRes.value.count     || 0) : 0;
    const invItems      = invItemsRes.status === 'fulfilled' ? (invItemsRes.value.data || []) : [];
    const lowStock      = invItems.filter(p => (p.qty || 0) <= (p.threshold || 0)).length;
    const upcomingAppts = apptRes.status     === 'fulfilled' ? (apptRes.value.count    || 0) : 0;
    const unreadNotifs  = notifRes.status    === 'fulfilled' ? (notifRes.value.count   || 0) : 0;

    let revenueThisMonth = 0;
    let unpaidInvoices   = 0;
    if (invRes.status === 'fulfilled') {
      const invoices = invRes.value.data || [];
      revenueThisMonth = invoices
        .filter(i => i.status === 'Paid' && i.paid_at?.startsWith(month))
        .reduce((s, i) => s + (Number(i.labor_amount) || 0) + (Number(i.parts_amount) || 0) + (Number(i.tax_amount) || 0), 0);
      unpaidInvoices = invoices.filter(i => ['Unpaid', 'Overdue'].includes(i.status)).length;
    }

    return {
      active_work_orders:    activeWOs,
      low_stock_parts:       lowStock,
      upcoming_appointments: upcomingAppts,
      revenue_this_month:    revenueThisMonth,
      unpaid_invoices:       unpaidInvoices,
      unread_notifications:  unreadNotifs,
    };
  }

  /* ---------------------------------------------------------------
     REVENUE CHARTS
     --------------------------------------------------------------- */
  async function getRevenueMonthly(months = 7) {
    const sid = await _shopId();
    const { data, error } = await sb.from('revenue_snapshots')
      .select('*').eq('shop_id', sid)
      .eq('period_type', 'month')
      .order('period', { ascending: true }).limit(months);
    if (error) throw error;
    return (data || []).map(r => ({
      label: r.period.slice(-2).replace(/^0/, ''),
      value: r.amount,
      formatted: formatCurrency(r.amount),
    }));
  }

  async function getRevenueWeekly() {
    const sid = await _shopId();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
    const since = days[0] + 'T00:00:00.000Z';

    const { data, error } = await sb.from('invoices')
      .select('paid_at, labor_amount, parts_amount, tax_amount')
      .eq('shop_id', sid).eq('status', 'Paid')
      .gte('paid_at', since).not('paid_at', 'is', null);
    if (error) throw error;

    const byDay = {};
    days.forEach(d => { byDay[d] = 0; });
    (data || []).forEach(inv => {
      const day = inv.paid_at.split('T')[0];
      if (byDay[day] !== undefined) {
        byDay[day] += (Number(inv.labor_amount) || 0)
                    + (Number(inv.parts_amount) || 0)
                    + (Number(inv.tax_amount)   || 0);
      }
    });

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days.map(d => ({
      label: dayNames[new Date(d + 'T12:00:00').getDay()],
      value: byDay[d], date: d,
    }));
  }

  /* ---------------------------------------------------------------
     STAFF  — only staff belonging to this shop
     --------------------------------------------------------------- */
  async function getStaff() {
    const sid = await _shopId();
    const { data, error } = await sb.from('profiles')
      .select('*').eq('shop_id', sid).order('full_name');
    if (error) throw error;
    return data;
  }

  async function updateProfile(id, payload) {
    const { data, error } = await sb.from('profiles')
      .update(payload).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  /* ---------------------------------------------------------------
     SHOP SETTINGS
     --------------------------------------------------------------- */
  async function getSettings() {
    const sid = await _shopId();
    const { data, error } = await sb.from('shop_settings')
      .select('*').eq('shop_id', sid).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  async function updateSettings(payload) {
    const sid = await _shopId();
    const existing = await getSettings();
    if (existing) {
      const { data, error } = await sb.from('shop_settings')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', existing.id).select().single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await sb.from('shop_settings')
        .insert({ ...payload, shop_id: sid }).select().single();
      if (error) throw error;
      return data;
    }
  }

  /* ---------------------------------------------------------------
     PUBLIC API
     --------------------------------------------------------------- */
  return {
    getCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer, getAuditLog,
    getVehicles, createVehicle, updateVehicle, deleteVehicle,
    getWorkOrders, getWorkOrder, createWorkOrder, updateWorkOrder, getWOStatusHistory,
    addPartToWorkOrder, removePartFromWorkOrder, getAllWorkOrderParts,
    getInventory, getInventoryItem, createInventoryItem, updateInventoryItem,
    adjustStock, getLowStockItems,
    getSuppliers, createSupplier, updateSupplier,
    getPurchaseOrders, createPurchaseOrder, updatePOStatus, receivePOItem,
    getInvoices, createInvoice, markInvoicePaid, updateInvoiceStatus,
    getAppointments, createAppointment, updateAppointment, cancelAppointment,
    createNotification, getNotifications, getUnreadCount, markNotificationRead,
    markAllNotificationsRead, deleteNotification, clearReadNotifications,
    getDashboardKPIs,
    getRevenueMonthly, getRevenueWeekly,
    getStaff, updateProfile,
    getSettings, updateSettings,
  };
})();

/* =================================================================
   LIVE NOTIFICATION BADGE
   ================================================================= */
async function initLiveNotificationBadge() {
  const count = await GS.getUnreadCount();
  updateNotifBadges(count);

  Realtime.subscribe('notifications', {
    onInsert: async (newNotif) => {
      const count = await GS.getUnreadCount();
      updateNotifBadges(count);
      Toast.show(newNotif.title, 'info', 5000);
    },
    onUpdate: async () => {
      const count = await GS.getUnreadCount();
      updateNotifBadges(count);
    },
  });
}

function updateNotifBadges(count) {
  document.querySelectorAll('.nav-badge, #sidebarBadge').forEach(el => {
    el.textContent = count;
    el.style.display = count > 0 ? '' : 'none';
  });
}
