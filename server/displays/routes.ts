import { Commands } from '../worker/commands.js'
import { activeDisplays } from '../shared/store.js'
import filePickerRouter from './filePicker.js'
import clipboardRouter from './clipboard.js'
import { resolveDisplay } from './session.js'
import { getPreview } from './preview.js'

const commands = new Commands()

commands.include(clipboardRouter)
commands.include(filePickerRouter)

commands.register(
  'displays.get.vncPort_preview',
  'GET',
  '/:vncPort/preview',
  async (req, res) => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    res.once('close', abort)
    try {
      const image = await getPreview(resolveDisplay(req.params.vncPort), controller.signal)
      if (!controller.signal.aborted)
        res.set('Cache-Control', 'no-store').type('image/jpeg').send(image)
    } catch (error) {
      if (!controller.signal.aborted) throw error
    } finally {
      res.removeListener('close', abort)
    }
  },
  'json',
)

commands.register(
  'displays.get.list',
  'GET',
  '/',
  (_req, res) => {
    const sorted = Array.from(activeDisplays.values()).sort((a, b) => {
      if (a.automationId !== b.automationId) return a.automationId.localeCompare(b.automationId)
      return a.profileName.localeCompare(b.profileName)
    })
    res.json(sorted)
  },
  'json',
)

export default commands
