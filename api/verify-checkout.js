const Stripe = require('stripe')
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

const ALLOW_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || '*'
function cors(res){
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

module.exports = async (req, res) => {
  cors(res); if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })

  try {
    const { session_id } = req.body || {}
    if (!session_id) return res.status(400).json({ error: 'Missing session_id' })

    const session = await stripe.checkout.sessions.retrieve(session_id)

    // Accept paid subscription or one-time payment
    const paid =
      session.status === 'complete' &&
      (session.payment_status === 'paid' || session.mode === 'subscription')

    if (!paid) {
      return res.status(402).json({ error: 'Payment not completed yet' })
    }

    // hand back useful bits to prefill Part 2
    return res.status(200).json({
      ok: true,
      customer_email: session.customer_details?.email || null,
      stripe_customer_id: session.customer || null,
      entity_id: session.metadata?.supabase_entity_id || null,
      state: session.metadata?.state || null,
      add_ons: (() => { try { return JSON.parse(session.metadata?.add_ons || '{}') } catch { return {} } })()
    })
  } catch (err) {
    console.error('verify error:', err?.message)
    return res.status(400).json({ error: err?.message || 'Verify error' })
  }
}
