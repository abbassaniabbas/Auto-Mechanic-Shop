/* =================================================================
   GEARSHIFT — BILLING.JS
   Paystack integration for:
     1. Pro plan subscriptions (monthly ₦10,500 / annual ₦90,000)
     2. Paystack subaccount setup per shop (for commission splits)
     3. Invoice online payment with automatic 5% GearShift commission

   Load AFTER supabase.js on pages that need billing:
     <script src="https://js.paystack.co/v1/inline.js"></script>
     <script src="../js/billing.js"></script>
   ================================================================= */

/* -----------------------------------------------------------------
   CONFIGURATION
   ----------------------------------------------------------------- */
const BILLING = {
  // ── Replace with your live key when going live ────────────────
  PAYSTACK_PUBLIC_KEY: 'pk_test_fae466db766719cea7b73682f7a0d8a2f86a7b2b',

  // ── Plan prices in kobo (Paystack uses the smallest currency unit)
  PLANS: {
    monthly: {
      label:     'Pro — Monthly',
      amount:    1050000,          // ₦10,500 in kobo
      display:   '₦10,500',
      period:    'month',
      cycle:     'monthly',
    },
    annual: {
      label:     'Pro — Annual',
      amount:    9000000,          // ₦90,000 in kobo
      display:   '₦90,000',
      period:    'year',
      cycle:     'annual',
      savings:   '₦36,000 saved vs monthly',
    },
  },

  // GearShift commission rate (5% of invoice payment)
  COMMISSION_RATE: 0.05,

  // Paystack transaction fee (1.5% + ₦100, capped at ₦2,000)
  // We use bearer: 'account' so the shop bears the fee on invoice payments
};

/* -----------------------------------------------------------------
   PLAN STATUS HELPERS
   ----------------------------------------------------------------- */
const BillingStatus = {
  async get() {
    try {
      const shop = await RBAC.getShop();
      if (!shop) return { plan: 'free', isProActive: false };
      const isProActive = shop.plan === 'pro' &&
        (!shop.plan_expires_at || new Date(shop.plan_expires_at) > new Date());
      return {
        plan:             shop.plan || 'free',
        isProActive,
        expiresAt:        shop.plan_expires_at,
        billingCycle:     shop.plan_billing_cycle,
        subaccountCode:   shop.paystack_subaccount_code,
        bankName:         shop.bank_name,
        bankAccountName:  shop.bank_account_name,
        bankAccountNumber:shop.bank_account_number,
      };
    } catch(e) {
      return { plan: 'free', isProActive: false };
    }
  },

  // Free plan hard limits
  FREE_LIMITS: {
    staff:     3,
    customers: 50,
  },

  async checkLimit(resource, currentCount) {
    const status = await this.get();
    if (status.isProActive) return { allowed: true };
    const limit = this.FREE_LIMITS[resource];
    if (!limit) return { allowed: true };
    if (currentCount >= limit) {
      return {
        allowed:  false,
        limit,
        resource,
        message:  `Free plan is limited to ${limit} ${resource}. Upgrade to Pro for unlimited ${resource}.`,
      };
    }
    return { allowed: true, remaining: limit - currentCount };
  },
};

/* -----------------------------------------------------------------
   PAYSTACK POPUP — PRO PLAN SUBSCRIPTION
   ----------------------------------------------------------------- */
const PaystackSubscription = {

  async start(cycle) {
    const planConfig = BILLING.PLANS[cycle];
    if (!planConfig) throw new Error('Invalid billing cycle');

    // Get current user email for Paystack
    const user = await Auth.getUser();
    if (!user?.email) throw new Error('Could not load your account email');

    const shop = await RBAC.getShop();
    if (!shop) throw new Error('No shop linked to your account');

    return new Promise((resolve, reject) => {
      const handler = PaystackPop.setup({
        key:       BILLING.PAYSTACK_PUBLIC_KEY,
        email:     user.email,
        amount:    planConfig.amount,
        currency:  'NGN',
        ref:       'GS-SUB-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
        label:     shop.name + ' — ' + planConfig.label,
        metadata: {
          shop_id:       shop.id,
          shop_name:     shop.name,
          plan_cycle:    cycle,
          user_id:       user.id,
          custom_fields: [
            { display_name: 'Shop',  variable_name: 'shop_name',  value: shop.name },
            { display_name: 'Cycle', variable_name: 'plan_cycle', value: cycle },
          ],
        },
    onClose() {
    reject(new Error('Payment cancelled'));
      },
    callback(response) {
    PaystackSubscription._activate(shop.id, cycle, response.reference)
    .then(() => resolve(response))
    .catch(err => reject(err));
      },
      });
      handler.openIframe();
    });
  },

  async _activate(shopId, cycle, reference) {
    // Calculate expiry date
    const now     = new Date();
    const expires = new Date(now);
    if (cycle === 'monthly') {
      expires.setMonth(expires.getMonth() + 1);
    } else {
      expires.setFullYear(expires.getFullYear() + 1);
    }

    // Update shops table
    const { error: shopErr } = await sb.from('shops').update({
      plan:                 'pro',
      plan_expires_at:      expires.toISOString(),
      plan_billing_cycle:   cycle,
    }).eq('id', shopId);
    if (shopErr) throw shopErr;

    // Log the transaction
    const plan = BILLING.PLANS[cycle];
    await sb.from('billing_transactions').insert({
      shop_id:           shopId,
      type:              'subscription',
      paystack_reference: reference,
      gross_amount:      plan.amount / 100,   // convert kobo → naira
      commission_amount: 0,
      shop_amount:       plan.amount / 100,
      plan_cycle:        cycle,
      status:            'success',
    });

    // Clear RBAC cache so next getShop() reflects new plan
    RBAC.clearCache();
  },
};

/* -----------------------------------------------------------------
   PAYSTACK SUBACCOUNT SETUP
   (lets Paystack automatically split invoice payments 95/5)
   ----------------------------------------------------------------- */
const PaystackSubaccount = {

  async create(bankCode, accountNumber, businessName) {
    const shop = await RBAC.getShop();
    if (!shop) throw new Error('No shop found');

    // Call Paystack API via Supabase Edge Function
    // (we can't call Paystack from the browser with the secret key directly)
    const { data, error } = await sb.functions.invoke('create-paystack-subaccount', {
      body: {
        business_name:      businessName || shop.name,
        bank_code:          bankCode,
        account_number:     accountNumber,
        percentage_charge:  BILLING.COMMISSION_RATE * 100,   // 5
        shop_id:            shop.id,
      },
    });

    if (error) throw new Error(error.message || 'Could not create subaccount');
    if (!data?.subaccount_code) throw new Error('Subaccount creation failed — no code returned');

    // Save to shop record
    const { error: updateErr } = await sb.from('shops').update({
      paystack_subaccount_code: data.subaccount_code,
      bank_name:                data.bank_name,
      bank_account_name:        data.account_name,
      bank_account_number:      accountNumber,
      bank_code:                bankCode,
    }).eq('id', shop.id);
    if (updateErr) throw updateErr;

    RBAC.clearCache();
    return data;
  },
};

/* -----------------------------------------------------------------
   INVOICE PAYMENT WITH COMMISSION SPLIT
   ----------------------------------------------------------------- */
const PaystackInvoice = {

  async pay(invoiceId, amountNaira, customerEmail, subaccountCode) {
    const shop = await RBAC.getShop();
    const user = await Auth.getUser();

    // Amount in kobo
    const amountKobo = Math.round(amountNaira * 100);

    const paymentConfig = {
      key:          BILLING.PAYSTACK_PUBLIC_KEY,
      email:        customerEmail || user.email,
      amount:       amountKobo,
      currency:     'NGN',
      ref:          'GS-INV-' + invoiceId.slice(0, 8).toUpperCase() + '-' + Date.now(),
      label:        'Invoice Payment — ' + (shop?.name || 'GearShift'),
      metadata: {
        shop_id:    shop?.id,
        invoice_id: invoiceId,
        custom_fields: [
          { display_name: 'Invoice', variable_name: 'invoice_id', value: invoiceId },
          { display_name: 'Shop',    variable_name: 'shop_name',  value: shop?.name },
        ],
      },
    };

    // Add subaccount split if the shop has set up their bank
    if (subaccountCode) {
      paymentConfig.subaccount        = subaccountCode;
      paymentConfig.bearer            = 'account';   // shop bears Paystack fee
      paymentConfig.transaction_charge = Math.round(amountKobo * BILLING.COMMISSION_RATE);
    }

    return new Promise((resolve, reject) => {
      const handler = PaystackPop.setup({
        ...paymentConfig,
        onClose() {
          reject(new Error('Payment cancelled'));
        },
        callback(response) {
        PaystackInvoice._record(invoiceId, amountNaira, response.reference, subaccountCode, shop?.id)
        .then(() => resolve(response))
        .catch(err => reject(err));
          },
      });
      handler.openIframe();
    });
  },

  async _record(invoiceId, grossAmount, reference, subaccountCode, shopId) {
    const commission = subaccountCode ? Math.round(grossAmount * BILLING.COMMISSION_RATE * 100) / 100 : 0;
    const shopAmount = grossAmount - commission;

    // Log commission transaction
    await sb.from('billing_transactions').insert({
      shop_id:            shopId,
      type:               'commission',
      paystack_reference: reference,
      invoice_id:         invoiceId,
      gross_amount:       grossAmount,
      commission_amount:  commission,
      shop_amount:        shopAmount,
      status:             'success',
    }).catch(e => console.warn('Commission log failed:', e.message));

    // Mark invoice as paid
    const sid = await (async () => { try { return await GS.getSettings().then(() => shopId); } catch(e) { return shopId; } })();
    await sb.from('invoices').update({
      status:           'Paid',
      payment_method:   'Paystack',
      paid_at:          new Date().toISOString(),
      updated_at:       new Date().toISOString(),
      paystack_reference: reference,
    }).eq('id', invoiceId);
  },
};

/* -----------------------------------------------------------------
   NIGERIAN BANKS LIST (for subaccount setup form)
   Source: Paystack bank list API. Common banks pre-loaded.
   ----------------------------------------------------------------- */
const NG_BANKS = [
  { code: '044', name: 'Access Bank' },
  { code: '023', name: 'Citibank Nigeria' },
  { code: '063', name: 'Diamond Bank' },
  { code: '050', name: 'EcoBank Nigeria' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '214', name: 'First City Monument Bank' },
  { code: '058', name: 'Guaranty Trust Bank' },
  { code: '030', name: 'Heritage Bank' },
  { code: '301', name: 'Jaiz Bank' },
  { code: '082', name: 'Keystone Bank' },
  { code: '526', name: 'Moniepoint MFB' },
  { code: '014', name: 'Mainstreet Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '101', name: 'Providus Bank' },
  { code: '221', name: 'Stanbic IBTC Bank' },
  { code: '068', name: 'Standard Chartered Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '100', name: 'Suntrust Bank' },
  { code: '032', name: 'Union Bank of Nigeria' },
  { code: '033', name: 'United Bank for Africa' },
  { code: '215', name: 'Unity Bank' },
  { code: '035', name: 'Wema Bank' },
  { code: '057', name: 'Zenith Bank' },
  { code: '120001', name: 'Opay' },
  { code: '999992', name: 'PalmPay' },
  { code: '090405', name: 'Kuda Bank' },
];
