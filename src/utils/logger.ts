import pino from 'pino';

// Create logger instance — always write to stderr so stdout stays clean
// for programmatic consumers (e.g. mocha test output).
export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            destination: 2, // write to stderr
          },
        }
      : undefined,
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  // pino destination: stderr
  pino.destination({ dest: 2, sync: true }),
);

export default logger;
