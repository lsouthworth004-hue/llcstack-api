const Stripe = require('stripe')
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

module.exports = async (req, res) => {
  // Stripe requires the raw body to verify signatures.
  // Vercel gives you the raw body on Node runtimes when you don't parse JSON here.
  const sig = req.headers['stripe-signature']
  const whsec = process.env.STRIPE_WEBHOOK_SECRET
  if (!whsec) return res.status(400).send('Missing STRIPE_WEBHOOK_SECRET')

  let event
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks)
    event = stripe.webhooks.constructEvent(rawBody, sig, whsec)
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const defer = session.metadata?.defer_recurring || ''
      const customerId = session.customer

      // create the deferred subscription (if any)
      if (defer === 'mail' && process.env.MAIL_MONTHLY_PRICE_ID) {
        await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: process.env.MAIL_MONTHLY_PRICE_ID }],
          payment_behavior: 'default_incomplete',
          expand: ['latest_invoice.payment_intent'],
        })
      } else if (defer === 'ra' && process.env.RA_YEARLY_PRICE_ID) {
        await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: process.env.RA_YEARLY_PRICE_ID }],
          payment_behavior: 'default_incomplete',
          expand: ['latest_invoice.payment_intent'],
        })
      }
    }

    return res.json({ received: true })
  } catch (err) {
    console.error('Webhook handler error:', err)
    return res.status(500).send('Webhook handler error')
  }
}
