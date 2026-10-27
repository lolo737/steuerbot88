// Supabase Edge Function (Deno): creates a Stripe PaymentIntent for the paywall.
// Set STRIPE_SECRET_KEY as a function secret: supabase secrets set STRIPE_SECRET_KEY=sk_test_...
import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import Stripe from "npm:stripe@14";

const app = new Hono();

app.use('*', logger(console.log));

app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

app.get("/make-server-eacb9d52/health", (c) => c.json({ status: "ok" }));

// Only the two published plan prices are accepted, so the browser can't pick its own price.
const ALLOWED_AMOUNTS = new Set([1999, 2999]);

app.post("/make-server-eacb9d52/create-payment-intent", async (c) => {
  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return c.json({ error: "Stripe not configured" }, 500);

    const { amountCents, email } = await c.req.json();

    if (typeof amountCents !== "number" || !ALLOWED_AMOUNTS.has(amountCents)) {
      return c.json({ error: "Unknown plan amount" }, 400);
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "eur",
      payment_method_types: ["card"],
      ...(typeof email === "string" && email.includes("@") ? { receipt_email: email } : {}),
      metadata: { source: "steuerbot88" },
    });

    return c.json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error("create-payment-intent:", err);
    return c.json({ error: "Payment setup failed" }, 500);
  }
});

Deno.serve(app.fetch);
