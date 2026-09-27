import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const names = new Intl.DisplayNames(['en'], { type: 'region' })
const countries = Array.from({ length: 26 * 26 }, (_, index) =>
  String.fromCharCode(65 + Math.floor(index / 26), 65 + index % 26))
  .map(code => ({ code: code.toLowerCase(), name: names.of(code) ?? code }))
  .filter(row => row.name.toUpperCase() !== row.code.toUpperCase() && row.name !== 'Unknown Region')
  .sort((a, b) => a.name.localeCompare(b.name))

export function CountrySelect({ value, onChange, disabled }: {
  value: string
  onChange: (country: string) => void
  disabled?: boolean
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="proxy-country" className="text-muted-copy text-xs font-semibold tracking-wider uppercase">
        Country
      </Label>
      <Select value={value || 'unset'} onValueChange={v => onChange(v === 'unset' ? '' : v)} disabled={disabled}>
        <SelectTrigger id="proxy-country" className="brand-focus bg-field border-line h-10 text-ink">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="panel-dropdown max-h-72">
          <SelectItem value="unset">Choose country</SelectItem>
          {countries.map(row => <SelectItem key={row.code} value={row.code}>
            {row.name} ({row.code.toUpperCase()})
          </SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
