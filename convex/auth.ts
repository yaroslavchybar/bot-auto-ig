import type { UserIdentity } from 'convex/server'
import {
  action as baseAction,
  mutation as baseMutation,
  query as baseQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'

type AuthenticatedCtx = Pick<QueryCtx, 'auth'> | Pick<MutationCtx, 'auth'> | Pick<ActionCtx, 'auth'>

export async function requireUserIdentity(ctx: AuthenticatedCtx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity()

  if (!identity) {
    throw new Error('Unauthorized')
  }

  return identity
}

export const query = ((definition: any) =>
  baseQuery({
    ...definition,
    handler: async (ctx: QueryCtx, args: unknown) => {
      await requireUserIdentity(ctx)
      return definition.handler(ctx, args)
    },
  })) as typeof baseQuery

export const mutation = ((definition: any) =>
  baseMutation({
    ...definition,
    handler: async (ctx: MutationCtx, args: unknown) => {
      await requireUserIdentity(ctx)
      return definition.handler(ctx, args)
    },
  })) as typeof baseMutation

export const action = ((definition: any) =>
  baseAction({
    ...definition,
    handler: async (ctx: ActionCtx, args: unknown) => {
      await requireUserIdentity(ctx)
      return definition.handler(ctx, args)
    },
  })) as typeof baseAction
