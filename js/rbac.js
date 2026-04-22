/* =================================================================
   GEARSHIFT — RBAC.JS
   Role-Based Access Control for the frontend
   Load this AFTER supabase.js on every app page:
     <script src="../js/rbac.js"></script>
   ================================================================= */

const RBAC = (() => {

  /* ---------------------------------------------------------------
     PERMISSION MAP
     Defines what each role can do on each section
     'full'  = read + write + delete
     'read'  = view only, no add/edit/delete buttons
     false   = no access, nav item greyed + page redirects
     --------------------------------------------------------------- */
  const PERMISSIONS = {
    dashboard:    { Admin: 'full', 'Service Advisor': 'full', Mechanic: 'read', 'Parts Manager': 'read' },
    appointments: { Admin: 'full', 'Service Advisor': 'full', Mechanic: 'read', 'Parts Manager': false  },
    customers:    { Admin: 'full', 'Service Advisor': 'full', Mechanic: false,  'Parts Manager': false  },
    'work-orders':{ Admin: 'full', 'Service Advisor': 'full', Mechanic: 'read', 'Parts Manager': 'read' },
    inventory:    { Admin: 'full', 'Service Advisor': 'read', Mechanic: false,  'Parts Manager': 'full' },
    'supply-chain':{ Admin: 'full','Service Advisor': false,  Mechanic: false,  'Parts Manager': 'full' },
    invoices:     { Admin: 'full', 'Service Advisor': 'full', Mechanic: false,  'Parts Manager': false  },
    reports:      { Admin: 'full', 'Service Advisor': false,  Mechanic: false,  'Parts Manager': false  },
    settings:     { Admin: 'full', 'Service Advisor': 'full', Mechanic: 'full', 'Parts Manager': 'full' },
    notifications:{ Admin: 'full', 'Service Advisor': 'full', Mechanic: 'full', 'Parts Manager': 'full' },
    staff:        { Admin: 'full', 'Service Advisor': false,  Mechanic: false,  'Parts Manager': false  },
  };

  /* ---------------------------------------------------------------
     CURRENT USER CACHE
     --------------------------------------------------------------- */
  let _currentUser = null;

  async function getCurrentUser() {
    if (_currentUser) return _currentUser;
    _currentUser = await Auth.getUser();
    return _currentUser;
  }

  function clearCache() { _currentUser = null; }
  function getCurrentUserSync() { return _currentUser; }

  /* ---------------------------------------------------------------
     PERMISSION CHECKS
     --------------------------------------------------------------- */
  function can(role, section) {
    const sectionPerms = PERMISSIONS[section];
    if (!sectionPerms) return 'full'; // unknown section — allow
    return sectionPerms[role] ?? false;
  }

  function canAccess(role, section)    { return can(role, section) !== false; }
  function canWrite(role, section)     { return can(role, section) === 'full'; }
  function isReadOnly(role, section)   { return can(role, section) === 'read'; }

  /* ---------------------------------------------------------------
     PAGE GUARD
     Call at top of each page's initPage()
     Redirects to dashboard if no access
     Returns the user profile if allowed
     --------------------------------------------------------------- */
  async function guardPage(section) {
    const session = await Auth.getSession();
    if (!session) {
      window.location.href = 'dashboard.html';
      return null;
    }

    const user = await getCurrentUser();
    if (!user) {
      window.location.href = 'dashboard.html';
      return null;
    }

    // Block deactivated staff
    if (user.active === false) {
      await Auth.signOut();
      window.location.href = 'dashboard.html?deactivated=1';
      return null;
    }

    const access = can(user.role, section);
    if (access === false) {
      Toast.show(`Access denied — ${user.role}s cannot access this section`, 'error', 4000);
      setTimeout(() => window.location.href = 'dashboard.html', 1500);
      return null;
    }

    // Apply read-only mode if needed
    if (access === 'read') {
      applyReadOnlyMode();
    }

    return user;
  }

  /* ---------------------------------------------------------------
     READ-ONLY MODE
     Hides all action buttons (add, edit, delete, save)
     Shows a read-only banner
     --------------------------------------------------------------- */
  function applyReadOnlyMode() {
    document.addEventListener('DOMContentLoaded', () => {
      // Hide write action buttons
      const writeSelectors = [
        '.app-btn-primary',
        '.btn-add',
        '.btn-edit',
        '.btn-delete',
        '[data-action="add"]',
        '[data-action="edit"]',
        '[data-action="delete"]',
        '[data-action="save"]',
      ];
      writeSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          // Don't hide navigation buttons, only action buttons
          if (!el.closest('.sidebar-nav') && !el.closest('.app-topbar-nav')) {
            el.style.display = 'none';
          }
        });
      });

      // Add read-only banner
      const topbar = document.querySelector('.app-topbar');
      if (topbar) {
        const banner = document.createElement('div');
        banner.style.cssText = `
          background:rgba(232,160,32,0.12); border:1px solid rgba(232,160,32,0.3);
          color:var(--amber); font-family:var(--ff-mono); font-size:10px;
          letter-spacing:1px; padding:6px 16px; border-radius:var(--r-sm);
          display:flex; align-items:center; gap:6px;
        `;
        banner.innerHTML = '👁 VIEW ONLY — your role does not have edit access';
        topbar.querySelector('.topbar-actions')?.prepend(banner);
      }
    });
  }

  /* ---------------------------------------------------------------
     SIDEBAR NAV RENDERER
     Replaces the static sidebar HTML with a dynamic one
     that greys out inaccessible links with a lock icon
     --------------------------------------------------------------- */
  function renderNav(role, activePage) {
    const navItems = [
      { section: 'dashboard',     label: 'Dashboard',     href: 'dashboard.html',    icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>' },
      { section: 'notifications', label: 'Notifications', href: 'notifications.html', icon: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>', badge: true },
    ];

    const opsItems = [
      { section: 'appointments',  label: 'Appointments',  href: 'appointments.html', icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
      { section: 'customers',     label: 'Customers',     href: 'customers.html',    icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
      { section: 'work-orders',   label: 'Work Orders',   href: 'work-orders.html',  icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' },
    ];

    const invItems = [
      { section: 'inventory',     label: 'Inventory',     href: 'inventory.html',    icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>' },
      { section: 'supply-chain',  label: 'Supply Chain',  href: 'supply-chain.html', icon: '<rect x="1" y="3" width="15" height="13"/><polygon points="16,8 20,8 23,11 23,16 16,16 16,8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>' },
    ];

    const finItems = [
      { section: 'invoices',      label: 'Invoices',      href: 'invoices.html',     icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
      { section: 'reports',       label: 'Reports',       href: 'reports.html',      icon: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
    ];

    const sysItems = [
      { section: 'staff',         label: 'Staff',         href: 'staff.html',        icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
      { section: 'settings',      label: 'Settings',      href: 'settings.html',     icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
    ];

    function buildItem(item) {
      const access = can(role, item.section);
      const isActive = activePage === item.section;
      const locked = access === false;
      const readOnly = access === 'read';

      const badge = item.badge ? `<span class="nav-badge" id="sidebarBadge" style="${locked?'display:none':''}"></span>` : '';
      const lockIcon = locked ? `<span style="margin-left:auto;font-size:10px;opacity:0.4">🔒</span>` : '';
      const roIcon = readOnly ? `<span style="margin-left:auto;font-size:9px;opacity:0.5;font-family:var(--ff-mono);letter-spacing:0.5px">VIEW</span>` : '';

      if (locked) {
        return `
          <div class="nav-item nav-item-locked"
               title="${item.label} — not available for ${role}"
               style="opacity:0.35;cursor:not-allowed;pointer-events:none;user-select:none;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${item.icon}</svg>
            ${item.label}${badge}${lockIcon}
          </div>`;
      }

      return `
        <a href="${item.href}" class="nav-item${isActive ? ' active' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${item.icon}</svg>
          ${item.label}${badge}${roIcon}
        </a>`;
    }

    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    nav.innerHTML = `
      <div class="nav-group-label">Core</div>
      ${navItems.map(buildItem).join('')}
      <div class="nav-group-label">Operations</div>
      ${opsItems.map(buildItem).join('')}
      <div class="nav-group-label">Inventory &amp; Supply</div>
      ${invItems.map(buildItem).join('')}
      <div class="nav-group-label">Finance</div>
      ${finItems.map(buildItem).join('')}
      <div class="nav-group-label">System</div>
      ${sysItems.map(buildItem).join('')}
    `;
  }

  /* ---------------------------------------------------------------
     SIDEBAR USER INFO
     Populates name, role, avatar from current user
     --------------------------------------------------------------- */
  async function renderSidebarUser() {
    const user = await getCurrentUser();
    if (!user) return;
    const nameEl   = document.getElementById('userName');
    const roleEl   = document.getElementById('userRole');
    const avatarEl = document.getElementById('userAvatar');
    const name = user.full_name || 'User';
    if (nameEl)   nameEl.textContent   = name;
    if (roleEl)   roleEl.textContent   = user.role || '—';
    if (avatarEl) {
      if (typeof renderAvatar === 'function') renderAvatar(avatarEl, name, user.avatar_url);
      else avatarEl.textContent = (typeof getInitials === 'function' ? getInitials(name) : name[0].toUpperCase());
    }
  }

  /* ---------------------------------------------------------------
     FULL SIDEBAR INIT
     Call once per page after DOM is ready and session is confirmed
     --------------------------------------------------------------- */
  async function initSidebar(activePage) {
    const user = await getCurrentUser();
    if (!user) return;
    renderNav(user.role, activePage);
    await renderSidebarUser();
    // Init notification badge on every page that has a sidebar
    if (typeof initLiveNotificationBadge === 'function') {
      initLiveNotificationBadge();
    }
  }

  /* ---------------------------------------------------------------
     HIDE WRITE BUTTONS for read-only users on a specific section
     Call after page content renders
     --------------------------------------------------------------- */
  function enforceWriteAccess(role, section) {
    if (canWrite(role, section)) return; // full access — nothing to hide

    // Hide primary action buttons in topbar
    document.querySelectorAll('.app-topbar .app-btn-primary').forEach(b => b.remove());

    // Disable/hide table action buttons
    document.querySelectorAll('[data-write], .btn-edit, .btn-delete, .action-btn').forEach(b => {
      b.disabled = true;
      b.style.opacity = '0.3';
      b.style.pointerEvents = 'none';
      b.title = 'Read-only access';
    });
  }

  /* ---------------------------------------------------------------
     SHOP REGISTRATION HELPERS
     --------------------------------------------------------------- */
  async function createShop(shopName, address, phone, email) {
    const { data, error } = await sb.rpc('create_shop_for_admin', {
      p_shop_name: shopName,
      p_address: address || null,
      p_phone: phone || null,
      p_email: email || null,
    });
    if (error) throw error;
    _currentUser = null; // clear cache so next getUser() refreshes
    return data;
  }

  async function acceptInvite(token) {
    const { data, error } = await sb.rpc('accept_staff_invite', { p_token: token });
    if (error) throw error;
    _currentUser = null;
    return data;
  }

  async function inviteStaff(email, role) {
    const { data, error } = await sb.rpc('invite_staff_member', {
      p_email: email,
      p_role: role,
    });
    if (error) throw error;
    return data;
  }

  async function getInviteByToken(token) {
    const { data: rows, error } = await sb.from('staff_invites')
      .select('*, shops(name)')
      .eq('token', token)
      .eq('accepted', false)
      .gt('expires_at', new Date().toISOString())
      .limit(1);
    if (error) return null;
    return rows?.[0] || null;
  }

  async function getShopInvites() {
    const user = await getCurrentUser();
    if (!user?.shop_id) return [];
    const { data, error } = await sb.from('staff_invites')
      .select('*')
      .eq('shop_id', user.shop_id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async function getShopStaff() {
    const user = await getCurrentUser();
    if (!user?.shop_id) return [];
    const { data, error } = await sb.from('profiles')
      .select('*')
      .eq('shop_id', user.shop_id)
      .order('full_name');
    if (error) throw error;
    return data;
  }

  async function updateStaffRole(profileId, role) {
    const { data, error } = await sb.from('profiles')
      .update({ role })
      .eq('id', profileId)
      .select();
    if (error) throw error;
    return data?.[0];
  }

  async function deactivateStaff(profileId) {
    // No-op: active column removed from profiles
    return null;
  }

  async function reactivateStaff(profileId) {
    // No-op: active column removed from profiles
    return null;
  }

  async function getShop() {
    try {
      // Get shop_id from cached user first, then fresh from DB if needed
      let shopId = _currentUser?.shop_id;

      if (!shopId) {
        const { data: { user: authUser } } = await sb.auth.getUser();
        if (!authUser) return null;
        const { data: rows } = await sb.from('profiles')
          .select('shop_id')
          .eq('id', authUser.id)
          .limit(1);
        shopId = rows?.[0]?.shop_id;
      }

      if (!shopId) return null;

      const { data: shopRows, error } = await sb.from('shops')
        .select('*')
        .eq('id', shopId)
        .limit(1);

      if (error) return null;
      const shop = shopRows?.[0] || null;
      if (shop && _currentUser) _currentUser.shop_id = shop.id;
      return shop;
    } catch(e) { return null; }
  }

  async function getShopId() {
    if (_currentUser?.shop_id) return _currentUser.shop_id;
    try {
      const { data: { user: authUser } } = await sb.auth.getUser();
      if (!authUser) return null;
      const { data: rows } = await sb.from('profiles')
        .select('shop_id')
        .eq('id', authUser.id)
        .limit(1);
      return rows?.[0]?.shop_id || null;
    } catch(e) { return null; }
  }

  /* ---------------------------------------------------------------
     PUBLIC API
     --------------------------------------------------------------- */
  return {
    // Permission checks
    can, canAccess, canWrite, isReadOnly,
    // Page setup
    guardPage, initSidebar, enforceWriteAccess, renderSidebarUser,
    // User
    getCurrentUser, getCurrentUserSync, clearCache,
    // Shop & invites
    createShop, acceptInvite, inviteStaff,
    getInviteByToken, getShopInvites, getShopStaff,
    updateStaffRole, deactivateStaff, reactivateStaff, getShop, getShopId,
    // Constants
    PERMISSIONS,
  };

})();
