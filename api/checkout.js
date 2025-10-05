// api/checkout.js
// Vercel serverless function — creates a Stripe Checkout Session
// Supports: one-time items (formation, state fee, EIN, certified copy)
//           + optional subscriptions (Registered Agent yearly, Mail Forwarding monthly)

const Stripe = require('stripe')
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

// Allow your site to call this function from the browser
const ALLOW_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || '*'
function cors(res){
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

// ---------- EDIT THESE PRICES (amounts in cents) ----------
const STATE_BASE = {
  FL: 400, DE: 400, WY: 400, CO: 400, NY: 400,
  // add more states...
}
const STATE_FILING_FEES = {
  FL: 12500, DE: 11000, WY: 10000, CO:  5000, NY: 20000,
  // add more states...
}
const ONE_TIME = {
  EIN: 4900,
  CERTIFIED_COPY: 3900, // change or add per-state overrides if needed
}

// Optional per-state override example:
// const CERT_BY_STATE = { NY: 6000, DE: 5000 }

const RA_PRICE_ID   = process.env.RA_YEARLY_PRICE_ID      // Stripe Price ID for Registered Agent (yearly $99)
const MAIL_PRICE_ID = process.env.MAIL_MONTHLY_PRICE_ID   // Stripe Price ID for Mail Forwarding (monthly $49)

// Build one-time line items
function buildOneTimeItems(state, add_ons = {}, legal_name = 'LLC'){
  if(!STATE_BASE[state] || !STATE_FILING_FEES[state]) throw new Error('Unsupported state')

  const items = [
    {
      price_data:{
        currency:'usd',
        product_data:{ name:`LLC Formation — ${legal_name} (${state})` },
        unit_amount: STATE_BASE[state],
      },
      quantity:1,
    },
    {
      price_data:{
        currency:'usd',
        product_data:{ name:`State Filing Fee (${state})` },
        unit_amount: STATE_FILING_FEES[state],
      },
      quantity:1,
    },
  ]

  if(add_ons.ein){
    items.push({
      price_data:{ currency:'usd', product_data:{ name:'EIN Filing (one-time)' }, unit_amount: ONE_TIME.EIN },
      quantity:1,
    })
  }

  if(add_ons.certified_copy){
    // const cert = CERT_BY_STATE[state] ?? ONE_TIME.CERTIFIED_COPY
    const cert = ONE_TIME.CERTIFIED_COPY
    items.push({
      price_data:{ currency:'usd', product_data:{ name:'Certified Copy (one-time)' }, unit_amount: cert },
      quantity:1,
    })
  }

  return items
}

// Build recurring items (subscriptions)
function buildRecurringItems(add_ons = {}){
  const rec = []
  if(add_ons.ra){
    if(!RA_PRICE_ID) throw new Error('Registered Agent selected but RA_YEARLY_PRICE_ID is not set')
    rec.push({ price: RA_PRICE_ID, quantity: 1 })
  }
  if(add_ons.mail_forwarding){
    if(!MAIL_PRICE_ID) throw new Error('Mail Forwarding selected but MAIL_MONTHLY_PRICE_ID is not set')
    rec.push({ price: MAIL_PRICE_ID, quantity: 1 })
  }
  return rec
}

module.exports = async (req, res) => {
  cors(res)
  if(req.method === 'OPTIONS') return res.status(200).end()

  try{
    if(req.method !== 'POST') return res.status(405).json({ error:'Use POST' })

    const { customer_id, email, entity_id, state, add_ons = {}, legal_name = 'LLC' } = req.body || {}
    if(!customer_id || !email || !entity_id || !state){
      return res.status(400).json({ error:'Missing required fields' })
    }

    // one-time items are always included
    const oneTime = buildOneTimeItems(state, add_ons, legal_name)

    // if RA or Mail is selected → subscription mode; otherwise payment mode
    const recurring = buildRecurringItems(add_ons)
    const mode = recurring.length ? 'subscription' : 'payment'
    const line_items = recurring.length ? [...recurring, ...oneTime] : oneTime

    // create (simple) customer record in Stripe
    const customer = await stripe.customers.create({ email })

    const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://llcstack.com'

    const session = await stripe.checkout.sessions.create({
      mode,
      customer: customer.id,
      line_items,
      // save card for later if doing one-time only (handy if you add subs later)
      payment_intent_data: mode === 'payment' ? { setup_future_usage: 'off_session' } : undefined,
      success_url: `${site}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/checkout-cancelled`,
      metadata: {
        supabase_customer_id: customer_id,
        supabase_entity_id: entity_id,
        state,
        add_ons: JSON.stringify(add_ons),
      },
    })

    return res.status(200).json({ url: session.url })
  }catch(err){
    console.error('checkout error:', err?.message)
    return res.status(400).json({ error: err?.message || 'Checkout error' })
  }
}
