import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "@hono/node-server/serve-static";

import { coderAgent } from "./agents/coder/agent.ts";
import { auditorAgent } from "./agents/auditor/agent.ts";
import { testerAgent } from "./agents/tester/agent.ts";

const app = new Hono();

app.use("/api/*", cors());

app.post("/api/run", (c) => {
  return streamSSE(c, async (stream) => {
    const body = await c.req.json<{ requirements: string }>();
    const requirements = body.requirements?.trim();

    if (!requirements) {
      await stream.writeSSE({ event: "error", data: "Requisitos não fornecidos." });
      return;
    }

    let eventId = 0;

    const send = async (event: string, data: string) => {
      await stream.writeSSE({ id: String(eventId++), event, data });
    };

    try {
      // === CODER ===
      await send("log", "[Coder] Gerando smart contract a partir dos requisitos...");
      const coderResult = await coderAgent.invoke({ requirements: [requirements] });

      await send("log", "[Coder] Contrato gerado com sucesso.");

      if (coderResult.compilationErrors.length > 0) {
        await send("log", `[Coder] Erros de compilação restantes: ${coderResult.compilationErrors.length}`);
      } else {
        await send("log", "[Coder] Contrato compilado sem erros.");
      }

      await send("coder", JSON.stringify({
        contract: coderResult.contract,
        compilationErrors: coderResult.compilationErrors,
        reviewSummary: coderResult.reviewSummary,
      }));

      // === AUDITOR ===
      await send("log", "[Auditor] Iniciando auditoria de segurança...");
      const auditorResult = await auditorAgent.invoke({ solidityFile: coderResult.contract });
      await send("log", `[Auditor] ${auditorResult.vulnerabilities.length} vulnerabilidade(s) encontrada(s).`);

      await send("auditor", JSON.stringify({
        vulnerabilities: auditorResult.vulnerabilities,
      }));

      // === TESTER ===
      await send("log", "[Tester] Gerando testes de prova de conceito...");
      const testerResult = await testerAgent.invoke({
        solidityFiles: [coderResult.contract],
        vulnerability: auditorResult.vulnerabilities[0] ?? {},
      });
      await send("log", `[Tester] ${testerResult.results.length} resultado(s) de teste.`);

      await send("tester", JSON.stringify({
        results: testerResult.results,
      }));

      await send("log", "Pipeline concluído.");
      await send("done", "ok");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await send("error", message);
    }
  });
});

// Serve static frontend files (built React app)
app.use("/*", serveStatic({ root: "./frontend/dist" }));

const port = Number(process.env.PORT) || 7860;
console.log(`Servidor rodando em http://localhost:${port}`);
serve({ fetch: app.fetch, port });
