// pnpm vapid:keys — prints a fresh VAPID key pair for production setup.
// Public key → VITE_VAPID_PUBLIC_KEY (site build) and VAPID_PUBLIC_KEY (Edge secret).
// Private key → VAPID_PRIVATE_KEY (Edge secret only, never in the site).
import { generateVapidKeys } from './lib/vapid.ts';

const k = await generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}`);
