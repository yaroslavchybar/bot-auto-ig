import type { Id } from './_generated/dataModel';

export const lookbackMs = 86400_000;

export const jobKey = (username: string, listId: Id<'leadLists'>, days: number, posts: number) =>
  JSON.stringify([username, listId, days, posts]);
