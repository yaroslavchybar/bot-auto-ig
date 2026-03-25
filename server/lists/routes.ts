
import { Router } from 'express'
import {
    listsList,
    listsCreate,
    listsUpdate,
    listsDelete
} from '../shared/convexClient.js'
import { asyncHandler } from '../shared/asyncHandler.js'
import { ValidationError } from '../shared/errors.js'

const router = Router()

// Get all lists
router.get('/', asyncHandler(async (_req, res) => {
    const lists = await listsList()
    res.json(lists)
}))

// Create a list
router.post('/', asyncHandler(async (req, res) => {
    const { name } = req.body
    if (!name) {
        throw new ValidationError('name is required')
    }
    const list = await listsCreate(name)
    res.json(list)
}))

router.post('/update', asyncHandler(async (req, res) => {
    const { id, name } = req.body || {}
    if (!id) {
        throw new ValidationError('id is required')
    }
    if (!name) {
        throw new ValidationError('name is required')
    }
    const list = await listsUpdate(String(id), String(name))
    res.json(list)
}))

router.post('/delete', asyncHandler(async (req, res) => {
    const { id } = req.body || {}
    if (!id) {
        throw new ValidationError('id is required')
    }
    await listsDelete(String(id))
    res.json({ success: true })
}))

// Update a list (Route param version)
router.put('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params
    const { name } = req.body
    if (!name) {
        throw new ValidationError('name is required')
    }
    const list = await listsUpdate(id, name)
    res.json(list)
}))

// Delete a list (Route param version)
router.delete('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params
    await listsDelete(id)
    res.json({ success: true })
}))

export default router
