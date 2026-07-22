import { requireStableIdentifier } from "../domain/shared/canonical-record.js";

export type AttestPayOperatorConfig = Readonly<{
  id: string;
}>;

export function loadAttestPayOperatorConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AttestPayOperatorConfig {
  const value = environment.ATTESTPAY_OPERATOR_ID;
  if (typeof value !== "string") {
    throw new Error(
      "Invalid AttestPay operator configuration: ATTESTPAY_OPERATOR_ID",
    );
  }
  try {
    return Object.freeze({
      id: requireStableIdentifier(value, "Configured local operator ID"),
    });
  } catch {
    throw new Error(
      "Invalid AttestPay operator configuration: ATTESTPAY_OPERATOR_ID",
    );
  }
}
