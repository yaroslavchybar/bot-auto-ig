import { AuthenticatedImage } from '@/components/shared/AuthenticatedImage'
import type { ModelContentItem } from '../types'

export function ModelImage({
  modelId,
  item,
  className,
}: {
  modelId: string
  item: ModelContentItem
  className?: string
}) {
  return (
    <AuthenticatedImage
      path={
        '/api/ig-accounts/models/' +
        encodeURIComponent(modelId) +
        '/content/' +
        item.kind +
        '/' +
        encodeURIComponent(item.id) +
        '/image?thumbnail=1'
      }
      alt={item.name}
      className={className}
    />
  )
}
