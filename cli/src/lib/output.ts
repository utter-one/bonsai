export interface SuccessEnvelope {
  status: 'ok';
  data: unknown;
  error: null;
  meta: Record<string, unknown>;
}

export interface ErrorEnvelope {
  status: 'error';
  data: null;
  error: {
    code: string;
    message: string;
    http_status: number;
    details: unknown;
  };
  meta: Record<string, unknown>;
}

export type Envelope = SuccessEnvelope | ErrorEnvelope;

export function successEnvelope(data: unknown, meta: Record<string, unknown> = {}): SuccessEnvelope {
  return {
    status: 'ok',
    data,
    error: null,
    meta,
  };
}

export function errorEnvelope(code: string, message: string, httpStatus: number, details: unknown = null, meta: Record<string, unknown> = {}): ErrorEnvelope {
  return {
    status: 'error',
    data: null,
    error: {
      code,
      message,
      http_status: httpStatus,
      details,
    },
    meta,
  };
}

export function printEnvelope(envelope: Envelope, isJson: boolean): void {
  if (isJson) {
    process.stdout.write(JSON.stringify(envelope) + '\n');
  } else {
    if (envelope.status === 'ok') {
      printSuccessHuman(envelope.data);
    } else {
      printErrorHuman(envelope);
    }
  }
}

function printSuccessHuman(data: unknown): void {
  if (data === null || data === undefined) {
    process.stdout.write('OK\n');
  } else if (Array.isArray(data)) {
    if (data.length === 0) {
      process.stdout.write('(empty list)\n');
    } else {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    }
  } else if (typeof data === 'object') {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    process.stdout.write(String(data) + '\n');
  }
}

function printErrorHuman(envelope: ErrorEnvelope): void {
  process.stderr.write(`Error [${envelope.error.code}]: ${envelope.error.message}\n`);
  if (envelope.error.details) {
    process.stderr.write(`Details: ${JSON.stringify(envelope.error.details)}\n`);
  }
}
