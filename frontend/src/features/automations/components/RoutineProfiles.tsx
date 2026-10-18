export function RoutineProfiles({
  profiles,
}: {
  profiles: { _id: string; name: string }[] | undefined
}) {
  if (!profiles)
    return (
      <p role="status" className="text-sm text-subtle-copy">
        Loading profiles…
      </p>
    )
  if (!profiles.length)
    return <p className="text-sm text-subtle-copy">No profiles in this model yet.</p>
  return (
    <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line-soft">
      {profiles.map((profile) => (
        <li key={profile._id} className="px-4 py-3 text-sm font-medium text-ink">
          {profile.name}
        </li>
      ))}
    </ul>
  )
}
