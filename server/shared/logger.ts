import pino from 'pino'

const IS_PRODUCTION = process.env.NODE_ENV === 'production'

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(IS_PRODUCTION
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
})

export default logger
