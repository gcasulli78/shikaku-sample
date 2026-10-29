import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";

/** Impronta CSP di uno script (Web Crypto: niente @types/node solo per questo). */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}

/**
 * Content Security Policy nel file unico: si esegue solo lo script del gioco (per impronta
 * sha256, calcolata dopo che viteSingleFile l'ha inserito nell'HTML), il Worker parte da
 * blob: (o data:), niente connessioni né risorse esterne. Codice iniettato nella pagina
 * (un onerror="…" finito in un innerHTML) viene bloccato dal browser.
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
          file.source = html.replace(charset, (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
        }
      },
    },
  };
}

export default defineConfig({
  // La CSP va dopo viteSingleFile: l'impronta è quella dello script già inserito.
  plugins: [viteSingleFile(), contentSecurityPolicy()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
