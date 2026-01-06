
interface ActivityItem {
  id: string
  action: string
  details: string
  timestamp: number
  timeAgo: string
}

export function RecentActivity({ activity }: { activity: ActivityItem[] }) {
  if (!activity || activity.length === 0) {
    return <div className="text-muted-foreground">No recent activity</div>
  }

  return (
    <div className="space-y-8">
      {activity.map((item) => (
        <div className="flex items-center" key={item.id}>
          <div className="ml-4 space-y-1">
            <p className="text-sm font-medium leading-none">
              {item.action}
            </p>
            <p className="text-sm text-muted-foreground">
              {item.details}
            </p>
          </div>
          <div className="ml-auto font-medium">{new Date(item.timestamp).toLocaleTimeString()}</div>
        </div>
      ))}
    </div>
  )
}
