/** Small in-memory caches evict old entries without deleting their durable state. */
export class LruMap<K, V> extends Map<K, V> {
  constructor(private readonly capacity: number) { super() }
  override get(key: K): V | undefined {
    const value = super.get(key)
    if (super.has(key)) { super.delete(key); super.set(key, value!) }
    return value
  }
  override set(key: K, value: V): this {
    super.delete(key)
    super.set(key, value)
    while (this.size > this.capacity) super.delete(this.keys().next().value!)
    return this
  }
}
