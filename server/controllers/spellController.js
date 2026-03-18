const axios = require('axios');
const Spell = require('../models/Spell');
const DailySpell = require('../models/DailySpell');

// Base URL for the D&D API (from our .env file)
const DND_API_URL = process.env.DND_API_BASE_URL || 'https://www.dnd5eapi.co/api';
const SPELL_COOLDOWN_DAYS = 30; // Don't show same spell within 30 days

/**
 * Helper function: Get a normalized list of all spells
 * Returns an array of { index, name } objects
 */
async function getNormalizedSpellList() {
  try {
    // First, try to get from database ignoring the id placed on it by mongodb
    const dbSpells = await Spell.find({}).select('index name -_id').lean();
    
    if (dbSpells.length > 0) {
      console.log(`Using ${dbSpells.length} spells from database`);
      return dbSpells;
    }

    // If no spells in DB, fetch from API
    console.log('Fetching spell list from D&D API...');
    const response = await axios.get(`${DND_API_URL}/spells`);
    
    if (!response.data || !response.data.results) {
      throw new Error('Invalid response from D&D API');
    }
    
    // Normalize the API response
    const normalizedSpells = response.data.results.map(spell => ({
      index: spell.index,
      name: spell.name
    }));
    
    // Save spells to database for future use
    // Create minimal spell entries first
    const spellPromises = normalizedSpells.map(async (spell) => {
      try {
        await Spell.findOneAndUpdate(
          { index: spell.index },
          { 
            index: spell.index,
            name: spell.name,
            desc: [],
            level: 0,
            school: { name: 'Unknown', index: 'unknown' }
          },
          { upsert: true, new: true }
        );
      } catch (err) {
        console.error(`Error saving spell ${spell.index} to DB:`, err.message);
      }
    });
    
    await Promise.all(spellPromises);
    console.log(`Found and saved ${normalizedSpells.length} spells in API`);
    
    return normalizedSpells;
  } catch (error) {
    console.error('Error in getNormalizedSpellList:', error.message);
    throw new Error('Failed to fetch spell list from D&D API');
  }
}

/**
 * Helper function: Get spell name and description by index
 */
async function getSpellNameAndDescription(index) {
  try {
    // Check database first
    let spell = await Spell.findOne({ index }).select('name desc -_id').lean();
    
    // If we have the spell with description in DB, return it
    if (spell && spell.desc && spell.desc.length > 0) {
      console.log(`Found spell ${index} in database`);
      return {
        index: spell.index,
        name: spell.name,
        description: spell.desc.join('\n\n'), // Join paragraphs with double line break
      liked:spell.liked || false
      };
    }
    
    // Not in database or missing description, fetch from API
    console.log(`Fetching details for ${index} from API...`);
    const response = await axios.get(`${DND_API_URL}/spells/${index}`);
    const spellData = response.data;
    
    // Validate the response
    if (!spellData || !spellData.index) {
      throw new Error('Received malformed spell data from D&D API');
    }
    
    // Save full spell data to database with proper field validation
    const savedSpell = await Spell.findOneAndUpdate(
      { index: spellData.index },
      {
        index: spellData.index,
        name: spellData.name || 'Unknown Spell',
        desc: spellData.desc || [],
        higher_level: spellData.higher_level || [],
        level: spellData.level !== undefined ? spellData.level : 0,
        school: spellData.school || { name: 'Unknown', index: 'unknown' },
        ritual: spellData.ritual || false,
        casting_time: spellData.casting_time || 'Unknown',
        range: spellData.range || 'Unknown',
        components: spellData.components || [],
        material: spellData.material || '',
        duration: spellData.duration || 'Unknown',
        concentration: spellData.concentration || false,
        classes: spellData.classes || [],
        subclasses: spellData.subclasses || []
      },
      { upsert: true, new: true }
    );
    
    console.log(`Saved/Updated spell ${index} in database`);
    
    // Return only name and description
    return {
      index: savedSpell.index,
      name: spellData.name,
      description: spellData.desc ? spellData.desc.join('\n\n') : 'No description available.',
      liked:savedSpell.liked || false
    };
  } catch (error) {
    console.error(`Error fetching spell ${index}:`, error.message);
    
    // If API fetch fails, try to return whatever we have in DB
    try {
      const fallbackSpell = await Spell.findOne({ index }).select('name desc -_id').lean();
      if (fallbackSpell) {
        console.log(`Using fallback data for spell ${index} from database`);
        return {
          index: fallbackSpell.index,
          name: fallbackSpell.name,
          description: fallbackSpell.desc && fallbackSpell.desc.length > 0 
            ? fallbackSpell.desc.join('\n\n') 
            : 'Description temporarily unavailable.',
            liked:fallbackSpell.liked || false
        };
      }
    } catch (fallbackError) {
      console.error(`Fallback also failed for spell ${index}:`, fallbackError.message);
    }
    
    throw new Error(`Failed to fetch spell details for ${index}`);
  }
}

/**
 * Helper function: Get spells available based on cooldown period
 */
async function getAvailableSpells(allSpells, cooldownDays) {
  try {
    // Calculate the cutoff date for cooldown
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - cooldownDays);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
    
    // Find spells shown within the cooldown period
    const recentShownSpells = await DailySpell.find({ 
      date: { $gte: cutoffDateStr } 
    }).select('spellIndex -_id').lean();
    
    const recentShownIndexes = recentShownSpells.map(day => day.spellIndex);
    
    // Filter out spells shown during cooldown
    let availableSpells = allSpells.filter(
      spell => !recentShownIndexes.includes(spell.index)
    );
    
    // If no spells available after cooldown, use all spells (start over)
    if (availableSpells.length === 0) {
      console.log('No spells available within cooldown period. Starting fresh cycle...');
      availableSpells = allSpells;   
    
    }
    
    return availableSpells;
  } catch (error) {
    console.error('Error in getAvailableSpells:', error);
    return allSpells; // Fallback to all spells if there's an error
  }
}

/**
 * CONTROLLER FUNCTION: getDailySpell
 * Returns only the spell name and description for today's spell
 */
exports.getDailySpell = async (req, res) => {
  try {
    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    console.log(`Looking for spell for date: ${today}`);

    //Check if we already have a spell for today
    const todaySpell = await DailySpell.findOne({ date: today });

    if (todaySpell) {
      // We already picked a spell today! Just return it
      console.log('Found existing spell for today');
      
      try {
        // Get only the name and description
        const spell = await getSpellNameAndDescription(todaySpell.spellIndex);
        
        return res.json({
          success: true,
          spell: spell,
          message: "Today's spell (from cache)"
        });
      } catch (spellError) {
        // If we can't get the spell details, maybe the spell was deleted?
        console.error('Error fetching cached spell:', spellError);
        // Continue to pick a new spell
      }
    }

    //No spell for today yet - we need to pick one!
    console.log('No spell for today, picking a new one...');
    
    //Get normalized list of all spells
    const allSpells = await getNormalizedSpellList();
    
    if (!allSpells || allSpells.length === 0) {
      throw new Error('No spells available');
    }
    
    //Get available spells based on cooldown
    const availableSpells = await getAvailableSpells(allSpells, SPELL_COOLDOWN_DAYS);
    
    console.log(`Available spells to choose from: ${availableSpells.length}`);

    //Pick a random spell from available spells
    const randomIndex = Math.floor(Math.random() * availableSpells.length);
    const chosenSpellRef = availableSpells[randomIndex];
    
    console.log(`Chosen spell: ${chosenSpellRef.name} (${chosenSpellRef.index})`);

     // Get only the name and description of the chosen spell
    const spellData = await getSpellNameAndDescription(chosenSpellRef.index);

    //Record that we showed this spell today
    try {
      await DailySpell.create({
        date: today,
        spellIndex: chosenSpellRef.index
      });
      console.log('Recorded today\'s spell');
    } catch (recordError) {
      // If there's a duplicate key error, it means another request already created today's spell
      if (recordError.code === 11000) {
        console.log('Spell for today was already recorded by another request');
      } else {
        console.error('Error recording daily spell:', recordError);
      }
    }

    //Send the simplified spell back to the front-end
    res.json({
      success: true,
      spell: spellData,
      message: "Today's fresh new spell!"
    });

  } catch (error) {
    // Something went wrong - send an error response
    console.error('Error in getDailySpell:', error);
    
    // Try to provide a fallback spell if possible
    try {
      const fallbackSpells = await Spell.find({}).select('name desc -_id').limit(1).lean();
      if (fallbackSpells.length > 0) {
        const fallback = fallbackSpells[0];
        return res.json({
          success: true,
          spell: {
            name: fallback.name,
            description: fallback.desc && fallback.desc.length > 0 
              ? fallback.desc.join('\n\n') 
              : 'Description temporarily unavailable.',
              liked: fallback.liked || false
          },
          message: "Today's spell (fallback)"
        });
      }
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch spell',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
    });
  }
};
/**
 * CONTROLLER FUNCTION: getAllSpells
 * Returns a paginated list of all spells with only name and description
 */
exports.getAllSpells = async (req, res) => {
  try {
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    
    // Get total count for pagination metadata
    const total = await Spell.countDocuments();
    
    // Get paginated spells - only name and description
    const spells = await Spell.find({})
      .select('name desc -_id')
      .skip(skip)
      .limit(limit)
      .lean();
    
    // Format description to be a single string
    const formattedSpells = spells.map(spell => ({
      name: spell.name || 'Unknown Spell',
      description: spell.desc && spell.desc.length > 0 
        ? spell.desc.join('\n\n') 
        : 'No description available.',
        liked: spell.liked || false
    }));
    
    res.json({
      success: true,
      page,
      totalPages: Math.ceil(total / limit),
      totalSpells: total,
      count: formattedSpells.length,
      spells: formattedSpells
    });
  } catch (error) {
    console.error('Error in getAllSpells:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch spells',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
    });
  }
};

/**
 * CONTROLLER FUNCTION: getSpellByIndex
 * Returns a specific spell by its index with only name and description
 */
exports.getSpellByIndex = async (req, res) => {
  try {
    const { index } = req.params;
    
    // Get only name and description
    const spell = await getSpellNameAndDescription(index);
    
    res.json({
      success: true,
      spell: spell
    });
  } catch (error) {
    console.error('Error in getSpellByIndex:', error);
    res.status(404).json({
      success: false,
      message: 'Spell not found',
      error: process.env.NODE_ENV === 'production' ? 'Spell not found' : error.message
    });
  }
};
//likespell 
exports.likeSpell = async (req, res) => {
  try{
    //pull the spell index from the url
    const  {index} = req.params;
    //finds the spell in the indexe and updates if liked 
    const updatedSpell = await Spell.findOneAndUpdate(
      {index},
      {liked:true},
      {new: true}
    );
    //if no spell found send 404
    if(!updatedSpell){
      return res.status(404).json({
        success:false,
        message: "spell not found"
      });
    }
    //send updated spell back to the front end to upate 
    res.json({
      success: true,
      message: `${updatedSpell.name} has been liked`,
      spell:{
        index: updatedSpell.index,
        name: updatedSpell.name,
        liked: updatedSpell.liked
      }
    });
  }catch(error){
    console.error('Error in likeSpell:', error);
    res.status(500).json({
      success:false,
      message: 'Failed to like spell',
      error: process.env.NODE_ENV === 'production' ? "internal server error" : error.message
    });
  }
};

//delete functionality 
exports.unlikeSpell = async (req, res) => {
  try{
    const {index} = req.params;
    const updatedSpell = await Spell.findOneAndUpdate(
      {index},
      {liked: false},
      {new: true}
    );
    if(!updatedSpell){
      return res.status(404).json({
        success: false,
        message: 'Spell not found'
      });
    }
    res.json({
      success: true,
      message: `${updatedSpell.name} has been unliked`,
      spell:{
        index:updatedSpell.index,
        name: updatedSpell.name,
        liked: updatedSpell.liked
      }
    });
  }catch (error){
    console.error('Error in unlikedSpell:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unlike spell',
      error: process.env.NODE_ENV === 'production' ? 'internal server error' : error.message
    });
  }
};

//delete functionality for spell

exports.deleteSpell = async (req, res) =>{
  try{
    const {index} = req.params
    //returns thee deleted spell to use in the responce
    const deletedSpell = await Spell.findOneAndDelete({index});

    if(!deletedSpell){
      return res.status(404).json({
        success: false,
        message: 'Spell not found'
      });
    }
    res.json({
      success:true,
      message: `${deletedSpell.name} has been deleted`
    });
  }catch (error){
    console.error('Error in deletedSpell', error);
      res.status(500).json({
        success:false,
        message: 'Failed to delete spell',
        error: process.env.NODE_ENV === 'production'? "Internal server error" : error.message
      });
  }
};
/**
 * CONTROLLER FUNCTION: resetDailySpells
 * Resets the daily spell tracking (useful for testing)
 */
exports.resetDailySpells = async (req, res) => {
  try {
    await DailySpell.deleteMany({});
    res.json({
      success: true,
      message: 'Daily spell tracking has been reset'
    });
  } catch (error) {
    console.error('Error in resetDailySpells:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
    });
  }
};

/**
 * CONTROLLER FUNCTION: getSpellStatistics
 * Returns basic statistics about spells in the database
 */
exports.getSpellStatistics = async (req, res) => {
  try {
    const totalSpells = await Spell.countDocuments();
    const spellsWithDescriptions = await Spell.countDocuments({ 
      desc: { $exists: true, $ne: [] } 
    });
    //count how many spells the user has liked 
    const likedSpells = await Spell.countDocuments({liked:true});
    
    res.json({
      success: true,
      statistics: {
        totalSpells,
        spellsWithDescriptions,
        spellsPendingDetails: totalSpells - spellsWithDescriptions, likedSpells: likedSpells
      }
    });
  } catch (error) {
    console.error('Error in getSpellStatistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
    });
  }
};

/**
 * CONTROLLER FUNCTION: refreshSpellList
 * Admin function to manually refresh the spell list from API
 */
exports.refreshSpellList = async (req, res) => {
  try {
    console.log('Manually refreshing spell list from API...');
    
    const response = await axios.get(`${DND_API_URL}/spells`);
    
    if (!response.data || !response.data.results) {
      throw new Error('Invalid response from D&D API');
    }
    
    const spells = response.data.results;
    let updated = 0;
    let created = 0;
    
    for (const spell of spells) {
      const result = await Spell.findOneAndUpdate(
        { index: spell.index },
        { 
          index: spell.index,
          name: spell.name
        },
        { upsert: true, new: true }
      );
      
      if (result.isNew) {
        created++;
      } else {
        updated++;
      }
    }
    
    res.json({
      success: true,
      message: 'Spell list refreshed',
      stats: {
        total: spells.length,
        created,
        updated
      }
    });
  } catch (error) {
    console.error('Error in refreshSpellList:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh spell list',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
    });
  }
};