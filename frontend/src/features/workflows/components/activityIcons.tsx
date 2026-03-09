import { createElement, type ComponentProps } from 'react'
import {
  CircleDot,
  Clock,
  Film,
  GitBranch,
  GitFork,
  HelpCircle,
  List,
  LogOut,
  MessageCircle,
  Play,
  Repeat,
  Scroll,
  TerminalSquare,
  UserCheck,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'

const activityIconMap: Record<string, LucideIcon> = {
  CircleDot,
  Clock,
  Film,
  GitBranch,
  GitFork,
  List,
  LogOut,
  MessageCircle,
  Play,
  Repeat,
  Scroll,
  TerminalSquare,
  UserCheck,
  UserMinus,
  UserPlus,
}

export function getActivityIcon(iconName: string): LucideIcon {
  return activityIconMap[iconName] || HelpCircle
}

export function ActivityIcon({
  iconName,
  ...props
}: { iconName: string } & ComponentProps<LucideIcon>) {
  return createElement(getActivityIcon(iconName), props)
}
