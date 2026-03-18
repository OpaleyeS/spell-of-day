const express = require('express');
const router = express.Router();
const spellController = require('../controllers/spellController');

// GET /api/daily-spell - Get today's spell
router.get('/daily-spell', spellController.getDailySpell);

// GET /api/spells - Get all spells (paginated)
router.get('/spells', spellController.getAllSpells);

// GET /api/spells/statistics - Get spell statistics
router.get('/spells/statistics', spellController.getSpellStatistics);

// GET /api/spells/:index - Get a specific spell by index
router.get('/spells/:index', spellController.getSpellByIndex);

// POST /api/reset - Reset daily tracking (for testing)
router.post('/reset', spellController.resetDailySpells);

// POST /api/spells/refresh - Refresh spell list from API (admin only)
router.post('/spells/refresh', spellController.refreshSpellList);

//Put request to update the likes on the spell 
router.put('/spells/:index/like', spellController.likeSpell);

//Delete route to remove like from the spell
router.delete('/spells/:index/like',spellController.unlikeSpell);

//delete spell route 
router.delete('/spells/:index', spellController.deleteSpell);

module.exports = router;