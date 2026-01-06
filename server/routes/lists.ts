
import { Router } from 'express'
import {
    listsList,
    listsCreate,
    listsUpdate,
    listsDelete
} from '../lib/convex.js'

const router = Router()

// Get all lists
router.get('/', async (req, res) => {
    try {
        const lists = await listsList()
        res.json(lists)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

// Create a list
router.post('/', async (req, res) => {
    try {
        const { name } = req.body
        if (!name) {
            return res.status(400).json({ error: 'name is required' })
        }
        const list = await listsCreate(name)
        res.json(list)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

router.post('/update', async (req, res) => {
    try {
        const { id, name } = req.body || {}
        if (!id) {
            return res.status(400).json({ error: 'id is required' })
        }
        if (!name) {
            return res.status(400).json({ error: 'name is required' })
        }
        const list = await listsUpdate(String(id), String(name))
        res.json(list)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

router.post('/delete', async (req, res) => {
    try {
        const { id } = req.body || {}
        if (!id) {
            return res.status(400).json({ error: 'id is required' })
        }
        await listsDelete(String(id))
        res.json({ success: true })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

// Update a list (Route param version)
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params
        const { name } = req.body
        if (!name) {
            return res.status(400).json({ error: 'name is required' })
        }
        const list = await listsUpdate(id, name)
        res.json(list)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

// Delete a list (Route param version)
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params
        await listsDelete(id)
        res.json({ success: true })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message })
    }
})

export default router
