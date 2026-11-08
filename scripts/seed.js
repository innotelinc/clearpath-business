import { env } from "../server/env.js";
import { ensureBootstrap, seedDemo } from "../server/db.js";

const bootstrap = ensureBootstrap();
if (bootstrap.created) console.log(`Created the workspace owner for ${env.adminEmail}.`);
const made = seedDemo();
console.log(made ? `Seeded ${made} demonstration businesses.` : "Demo data already present; nothing to do.");
