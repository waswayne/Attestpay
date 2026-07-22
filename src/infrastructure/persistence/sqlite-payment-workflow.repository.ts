import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  PaymentWorkflow,
  PaymentWorkflowAuditEvent,
  PaymentWorkflowRepositoryPort,
} from "../../application/ports/payment-workflow.repository.port.js";

type WorkflowRow = Readonly<{
  payload_json: string;
}>;

type AuditRow = Readonly<{
  workflow_id: string;
  sequence: number;
  event_type: string;
  occurred_at: string;
  payload_json: string;
}>;

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? { __attestpayBigInt: item.toString() } : item,
  );
}

function deserialize<T>(value: string): T {
  return JSON.parse(value, (_key, item: unknown) => {
    if (
      typeof item === "object" &&
      item !== null &&
      "__attestpayBigInt" in item &&
      typeof item.__attestpayBigInt === "string"
    ) {
      return BigInt(item.__attestpayBigInt);
    }
    return item;
  }) as T;
}

export class SqlitePaymentWorkflowRepository
  implements PaymentWorkflowRepositoryPort
{
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(
      readFileSync(
        new URL("../../../migrations/0001_product_workflow.sql", import.meta.url),
        "utf8",
      ),
    );
  }

  close(): void {
    this.database.close();
  }

  async create(
    workflow: PaymentWorkflow,
    event: PaymentWorkflowAuditEvent,
  ): Promise<void> {
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO payment_workflows
           (id, version, state, payload_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          workflow.id,
          workflow.version,
          workflow.state,
          serialize(workflow),
          workflow.createdAt,
          workflow.updatedAt,
        );
      this.insertEvent(event);
    });
  }

  async get(id: string): Promise<PaymentWorkflow | null> {
    const row = this.database
      .prepare("SELECT payload_json FROM payment_workflows WHERE id = ?")
      .get(id) as WorkflowRow | undefined;
    return row ? Object.freeze(deserialize<PaymentWorkflow>(row.payload_json)) : null;
  }

  async list(): Promise<readonly PaymentWorkflow[]> {
    const rows = this.database
      .prepare(
        "SELECT payload_json FROM payment_workflows ORDER BY updated_at DESC, id ASC",
      )
      .all() as unknown as WorkflowRow[];
    return Object.freeze(
      rows.map((row) => Object.freeze(deserialize<PaymentWorkflow>(row.payload_json))),
    );
  }

  async listAuditEvents(
    id: string,
  ): Promise<readonly PaymentWorkflowAuditEvent[]> {
    const rows = this.database
      .prepare(
        `SELECT workflow_id, sequence, event_type, occurred_at, payload_json
         FROM payment_workflow_audit_events
         WHERE workflow_id = ? ORDER BY sequence ASC`,
      )
      .all(id) as unknown as AuditRow[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          workflowId: row.workflow_id,
          sequence: row.sequence,
          eventType: row.event_type,
          occurredAt: row.occurred_at,
          payload: Object.freeze(
            deserialize<Record<string, string | boolean | null>>(row.payload_json),
          ),
        }),
      ),
    );
  }

  async save(
    workflow: PaymentWorkflow,
    expectedVersion: number,
    event: PaymentWorkflowAuditEvent,
  ): Promise<boolean> {
    return this.transaction(() => {
      const update = this.updateWorkflow(workflow, expectedVersion);
      if (!update) return false;
      this.insertEvent(event);
      return true;
    });
  }

  async authorizeAtomically(input: {
    workflow: PaymentWorkflow;
    expectedVersion: number;
    replayKey: `sha256:${string}`;
    receiptHash: `sha256:${string}`;
    event: PaymentWorkflowAuditEvent;
  }): Promise<boolean> {
    return this.transaction(() => {
      const replayInsert = this.database
        .prepare(
          `INSERT OR IGNORE INTO authorization_replay_keys
           (replay_key, receipt_hash, workflow_id, consumed_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          input.replayKey,
          input.receiptHash,
          input.workflow.id,
          input.event.occurredAt,
        );
      if (replayInsert.changes !== 1) return false;

      if (!this.updateWorkflow(input.workflow, input.expectedVersion)) {
        throw new Error("Payment workflow changed during authorization.");
      }
      this.insertEvent(input.event);
      return true;
    });
  }

  private updateWorkflow(
    workflow: PaymentWorkflow,
    expectedVersion: number,
  ): boolean {
    const result = this.database
      .prepare(
        `UPDATE payment_workflows
         SET version = ?, state = ?, payload_json = ?, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .run(
        workflow.version,
        workflow.state,
        serialize(workflow),
        workflow.updatedAt,
        workflow.id,
        expectedVersion,
      );
    return result.changes === 1;
  }

  private insertEvent(event: PaymentWorkflowAuditEvent): void {
    this.database
      .prepare(
        `INSERT INTO payment_workflow_audit_events
         (workflow_id, sequence, event_type, occurred_at, payload_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        event.workflowId,
        event.sequence,
        event.eventType,
        event.occurredAt,
        serialize(event.payload),
      );
  }

  private transaction<T>(work: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.database.exec("COMMIT");
      return result;
    } catch (error: unknown) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
