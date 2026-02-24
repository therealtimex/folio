#!/usr/bin/env node

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function setup() {
  const envPath = join(process.cwd(), ".env");

  if (existsSync(envPath)) {
    const overwrite = await question("⚠️  .env exists. Overwrite? (y/N): ");
    if (overwrite.toLowerCase() !== "y") {
      console.log("Setup cancelled.");
      rl.close();
      return;
    }
  }

  const supabaseUrl = await question("Supabase URL: ");
  const supabaseAnonKey = await question("Supabase anon key: ");
  const port = (await question("API port [3006]: ")) || "3006";

  const env = `VITE_SUPABASE_URL=${supabaseUrl}\nVITE_SUPABASE_ANON_KEY=${supabaseAnonKey}\nVITE_API_URL=http://localhost:${port}\nPORT=${port}\nDISABLE_AUTH=true\nJWT_SECRET=dev-secret-change-in-production\n`;

  writeFileSync(envPath, env);

  console.log("✅ .env written");
  console.log("Next:\n  1) npm install\n  2) npm run migrate\n  3) npm run dev:api\n  4) npm run dev");
  rl.close();
}

setup().catch((error) => {
  console.error("❌ Setup failed:", error.message);
  rl.close();
  process.exit(1);
});
