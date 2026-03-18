const mongoose = require('mongoose');

// importing mongoose leting javascript comunicate with MongoDB
const spellSchema = new mongoose.Schema({
  // The index is how the D&D API identifies spells (e.g., "acid-arrow")
  index: {
    type: String,
    required: true,
    unique: true // No two spells can have the same index
  },
  
  // The spell's name (e.g., "Acid Arrow")
  name: {
    type: String,
    required: true
  },
  
  // The spell's description (array because spells can have multiple paragraphs)
  desc: [String],
  
  // Higher level description (for when cast at higher levels)
  higher_level: [String],
  
  // Spell level (0 for cantrips, 1-9 for other spells)
  level: {
    type: Number,
    required: true
  },
  
  // School of magic (evocation, illusion, etc.)
  school: {
    name: String,
    index: String
  },
  
  // Whether the spell can be cast as a ritual
  ritual: {
    type: Boolean,
    default: false
  },
  
  // Casting time, range, components, etc.
  casting_time: String,
  range: String,
  components: [String],
  material: String,
  duration: String,
  
  // Whether the spell requires concentration
  concentration: Boolean,
  
  // Which classes can cast this spell
  classes: [{
    name: String,
    index: String
  }],
  
  subclasses: [{
    name: String,
    index: String
  }],
  //track whe th euser liked the spell only true or false
liked:{
  type:Boolean,
  default:false
},
  // When we first saved this spell to our database
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create and export the model
// The first argument 'Spell' becomes the collection name 'spells' (Mongoose pluralizes it)
module.exports = mongoose.model('Spell', spellSchema);