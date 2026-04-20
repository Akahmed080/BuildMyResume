export default function handler(req, res) {
  console.log("Webhook received from Lemon Squeezy:", req.body);

  // Later we will:
  // 1. verify signature
  // 2. check subscription status
  // 3. unlock premium user in Firebase

  res.status(200).json({ success: true });
}
