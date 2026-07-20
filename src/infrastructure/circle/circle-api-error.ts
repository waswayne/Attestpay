type CircleApiErrorShape = Readonly<{
  message?: unknown;
  error?: {
    response?: {
      data?: {
        errors?: Array<{ location?: unknown; message?: unknown }>;
      };
    };
  };
}>;

export function circleApiErrorDetail(error: unknown): string {
  const sdkError = error as CircleApiErrorShape;
  const fieldErrors = sdkError.error?.response?.data?.errors
    ?.map((item) => {
      if (typeof item.message !== "string") return undefined;
      const valueSuffix = item.message.indexOf(" (was ");
      const message = valueSuffix === -1
        ? item.message
        : item.message.slice(0, valueSuffix);
      return typeof item.location === "string"
        ? `${item.location}: ${message}`
        : message;
    })
    .filter((message): message is string => Boolean(message));

  if (fieldErrors?.length) return fieldErrors.join("; ");
  return typeof sdkError.message === "string"
    ? sdkError.message
    : "unknown Circle API error";
}

export function sanitizedCircleApiCause(error: unknown): Error {
  return new Error(circleApiErrorDetail(error));
}
