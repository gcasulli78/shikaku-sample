import type { Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

/** CSP hash of a script (Web Crypto: no @types/node just for this). */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}

/**
 * Content Security Policy in the single file: only the game script runs (by sha256 hash, computed
 * after viteSingleFile has inlined it into the HTML), the Worker starts from blob: (or data:), no
 * external connections or resources. Code injected into the page (an onerror="…" ending up in an
 * innerHTML) is blocked by the browser.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: "shikaku:csp",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      async handler(_options, bundle) {
        for (const file of Object.values(bundle)) {
          if (file.type !== "asset" || !file.fileName.endsWith(".html")) continue;
          const html = String(file.source);
          const hashes = await Promise.all([...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => sha256(m[1]!)));
          const policy = [
            "default-src 'none'",
            `script-src ${hashes.join(" ")}`,
            "worker-src blob: data:",
            "style-src 'unsafe-inline'",
            "img-src data:",
            "base-uri 'none'",
          ].join("; ");
          const charset = /<meta charset="UTF-8" \/>/i;
          if (!charset.test(html)) this.error(`${file.fileName}: manca <meta charset>, dove inserire la CSP`);
          file.source = html.replace(
            charset,
            (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
          );
        }
      },
    },
  };
}

export default defineConfig({
  // The version shows at the bottom of the page: that way you know whether the site is up to date.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // The CSP goes after viteSingleFile: the hash is that of the already inlined script.
  plugins: [viteSingleFile(), contentSecurityPolicy()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
