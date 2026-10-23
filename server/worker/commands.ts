/** Authenticated JSON callbacks invoked by the native runtime. */
export type CommandRequest = { body: unknown; signal: AbortSignal }
export type CommandHandler = (request: CommandRequest) => unknown | Promise<unknown>
export type Commands = Record<string, CommandHandler>
