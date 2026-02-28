import dotenv from "dotenv";
import { existsSync } from "node:fs";
import path, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findPackageRoot(startDir: string): string {
  let current = startDir;
  while (current !== path.parse(current).root) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "bin"))) {
      return current;
    }
    current = dirname(current);
  }
  return process.cwd();
}

const packageRoot = findPackageRoot(__dirname);

function loadEnvironment() {
  const cwdEnv = join(process.cwd(), ".env");
  const rootEnv = join(packageRoot, ".env");

  if (existsSync(cwdEnv)) {
    dotenv.config({ path: cwdEnv, override: true });
  } else if (existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv, override: true });
  } else {
    dotenv.config();
  }
}

loadEnvironment();

function parseArgs(args: string[]): { port: number | null; noUi: boolean } {
  const portIndex = args.indexOf("--port");
  let port: number | null = null;

  if (portIndex !== -1 && args[portIndex + 1]) {
    const candidate = Number.parseInt(args[portIndex + 1], 10);
    if (!Number.isNaN(candidate) && candidate > 0 && candidate < 65536) {
      port = candidate;
    }
  } else {
    const portArg = args.find(a => a.startsWith("--port="));
    if (portArg) {
      const candidate = Number.parseInt(portArg.split("=")[1], 10);
      if (!Number.isNaN(candidate) && candidate > 0 && candidate < 65536) {
        port = candidate;
      }
    }
  }

  return {
    port,
    noUi: args.includes("--no-ui")
  };
}

const cliArgs = parseArgs(process.argv.slice(2));

export const config = {
  packageRoot,
  port: cliArgs.port || (process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3006),
  noUi: cliArgs.noUi,
  nodeEnv: process.env.NODE_ENV || "production",
  isProduction: (process.env.NODE_ENV || "production") === "production",
  rootDir: packageRoot,
  scriptsDir: join(packageRoot, "scripts"),

  supabase: {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  },

  security: {
    jwtSecret: process.env.JWT_SECRET || "dev-secret-change-in-production",
    encryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "",
    corsOrigins: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:5173", "http://localhost:3006"],
    rateLimitWindowMs: 60 * 1000,
    rateLimitMax: 60,
    disableAuth: process.env.DISABLE_AUTH === "true"
  }
};

export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const isHostedCloud = process.env.IS_HOSTED_CLOUD === "true";

  if (config.isProduction && isHostedCloud) {
    if (config.security.jwtSecret === "dev-secret-change-in-production") {
      errors.push("JWT_SECRET must be set in cloud production");
    }

    if (!config.security.encryptionKey) {
      errors.push("TOKEN_ENCRYPTION_KEY must be set in cloud production");
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
