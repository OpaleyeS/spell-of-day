const mongoose = require('mongoose');

const dailySpellSchema = new mongoose.Schema({
  // The date this spell was shown (we'll store it as a string in YYYY-MM-DD format)
  date: {
    type: String,
    required: true,
    unique: true // Only one spell per day
  },
  
  // Reference to the spell that was shown (using its index)
  spellIndex: {
    type: String,
    required: true
  },
  
  // When this record was created
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create a compound index to ensure we don't accidentally duplicate
// (though 'date' is already unique, this adds an extra layer)
dailySpellSchema.index({ date: 1, spellIndex: 1 }, { unique: true });

module.exports = mongoose.model('DailySpell', dailySpellSchema);