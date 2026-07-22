import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Address } from "viem";
import type { AuthorizationReceiptSignerPort } from "../../application/ports/authorization-receipt-signer.port.js";
import type {
  PaymentWorkflow,
  PaymentWorkflowRepositoryPort,
} from "../../application/ports/payment-workflow.repository.port.js";
import {
  decideManualApproval,
  signAndAuthorizePaymentWorkflow,
} from "../../application/use-cases/manage-payment-workflow.js";
import type { TrustedPaymentDeploymentContext } from "../../application/trusted-payment-deployment-context.js";
import { requireStableIdentifier } from "../../domain/shared/canonical-record.js";
import { parseCanonicalEvmAddress } from "../../shared/validation/evm.js";

type ExecuteWorkflow = (id: string, occurredAt: string) => Promise<PaymentWorkflow>;

function jsonValue(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(jsonValue(value));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 64_000) throw new Error("Request body is too large.");
  }
  const parsed: unknown = body ? JSON.parse(body) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function authorized(request: IncomingMessage, token: string): boolean {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

function workflowId(pathname: string): string | null {
  const match = /^\/api\/v1\/workflows\/([a-zA-Z0-9._:-]+)(?:\/|$)/.exec(pathname);
  return match?.[1] ?? null;
}

export function createPaymentWorkflowServer(input: {
  repository: PaymentWorkflowRepositoryPort;
  operatorToken: string;
  operatorId: string;
  approverAddress: Address;
  trustedDeployment: TrustedPaymentDeploymentContext;
  receiptSigner: AuthorizationReceiptSignerPort;
  executeWorkflow: ExecuteWorkflow;
}) {
  if (input.operatorToken.length < 20) {
    throw new Error("Operator API token must contain at least 20 characters.");
  }
  const operatorId = requireStableIdentifier(
    input.operatorId,
    "Configured local operator ID",
  );
  const approverAddress = parseCanonicalEvmAddress(input.approverAddress);

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/") {
        return sendAsset(response, "index.html", "text/html; charset=utf-8");
      }
      if (request.method === "GET" && url.pathname === "/app.js") {
        return sendAsset(response, "app.js", "text/javascript; charset=utf-8");
      }
      if (request.method === "GET" && url.pathname === "/styles.css") {
        return sendAsset(response, "styles.css", "text/css; charset=utf-8");
      }
      if (!url.pathname.startsWith("/api/")) {
        return sendJson(response, 404, { error: "NOT_FOUND" });
      }
      if (!authorized(request, input.operatorToken)) {
        return sendJson(response, 401, { error: "UNAUTHORIZED" });
      }
      if (request.method === "GET" && url.pathname === "/api/v1/workflows") {
        return sendJson(response, 200, { workflows: await input.repository.list() });
      }

      const id = workflowId(url.pathname);
      if (!id) return sendJson(response, 404, { error: "NOT_FOUND" });
      if (request.method === "GET" && url.pathname === `/api/v1/workflows/${id}`) {
        const workflow = await input.repository.get(id);
        if (!workflow) return sendJson(response, 404, { error: "NOT_FOUND" });
        return sendJson(response, 200, {
          workflow,
          auditEvents: await input.repository.listAuditEvents(id),
        });
      }
      if (request.method !== "POST") {
        return sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
      }

      const now = new Date().toISOString();
      if (
        url.pathname === `/api/v1/workflows/${id}/approve` ||
        url.pathname === `/api/v1/workflows/${id}/reject`
      ) {
        await readJson(request);
        const decision = url.pathname.endsWith("/approve") ? "APPROVED" : "REJECTED";
        const workflow = await decideManualApproval(input.repository, {
          workflowId: id,
          operatorId,
          approverAddress,
          decision,
          decidedAt: now,
        });
        return sendJson(response, 200, { workflow });
      }
      if (url.pathname === `/api/v1/workflows/${id}/authorize`) {
        const result = await signAndAuthorizePaymentWorkflow(
          input.repository,
          input.receiptSigner,
          input.trustedDeployment,
          { workflowId: id, verifiedAt: now },
        );
        return sendJson(response, result.valid ? 200 : 409, { verification: result });
      }
      if (url.pathname === `/api/v1/workflows/${id}/execute`) {
        const workflow = await input.executeWorkflow(id, now);
        return sendJson(response, 200, { workflow });
      }
      return sendJson(response, 404, { error: "NOT_FOUND" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unexpected server error.";
      const status = /not found/i.test(message) ? 404 : /cannot|only|eligible|changed/i.test(message) ? 409 : 400;
      return sendJson(response, status, { error: "REQUEST_REJECTED", message });
    }
  });
}

async function sendAsset(
  response: ServerResponse,
  name: "index.html" | "app.js" | "styles.css",
  contentType: string,
): Promise<void> {
  const content = await readFile(new URL(`./public/${name}`, import.meta.url));
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(content);
}
