/** Re-rendering and animations can invalidate a selected control without blocking the account. */
export function isTransientDomIssue(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).split(/\r?\n/, 1)[0]
  return (
    message === 'Action target is detached or missing' ||
    // Saved routine issues can still contain messages from before the wrapper upgrade.
    /^Element .+ failed (?:attached|visible|stable|pointer_events|target_identity) check:/i.test(
      message,
    ) ||
    /\belement (?:is not (?:visible|attached)|was detached|is detached)|not attached to the DOM|intercepts pointer events/i.test(
      message,
    )
  )
}
