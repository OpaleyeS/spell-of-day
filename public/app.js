// Configuration
const API_BASE_URL = 'http://localhost:5000/api';

// State management
let isLoading = false;
let currentSpell = null; // Track the currently displayed spell

// Helpers 

function setLoading(loading) {
    isLoading = loading;
    const loadingIndicator = document.getElementById('loading');
    const refreshBtn = document.getElementById('refreshBtn');
    const retryBtn = document.getElementById('retryBtn');

    if (loadingIndicator) loadingIndicator.classList.toggle('active', loading);
    if (refreshBtn)refreshBtn.disabled = loading;
    if (retryBtn)retryBtn.disabled   = loading;
}

function showError(message) {
    const errorMessage = document.getElementById('errorMessage');
    const spellCard = document.getElementById('spellCard');
    const spellName = document.getElementById('spellName');
    const spellDesc = document.getElementById('spellDescription');

    if (errorMessage) {
        errorMessage.classList.add('visible');
        const errorText = errorMessage.querySelector('p');
        if (errorText)errorText.textContent = message || 'The magic is fickle...';
    }
    // .faded class defined in style.css reduces opacity on the card
    if (spellCard) spellCard.classList.add('faded');
    if (spellName) spellName.textContent = 'Spell Unavailable';
    if (spellDesc) spellDesc.innerHTML = '<p>Unable to load spell description.</p>';
}

function hideError() {
    const errorMessage = document.getElementById('errorMessage');
    const spellCard = document.getElementById('spellCard');

    if (errorMessage) errorMessage.classList.remove('visible');
    if (spellCard) spellCard.classList.remove('faded');
}

/**
 * Parse spell description from various possible formats
 */
function parseDescription(description) {
    if (!description) return '<p>No description available.</p>';

    if (Array.isArray(description)) {
        if (description.length === 0) return '<p>No description available.</p>';
        return description.map(p => `<p>${p}</p>`).join('');
    }

    if (typeof description === 'string') {
        if (description.trim() === '') return '<p>No description available.</p>';
        if (description.includes('<') && description.includes('>')) return description;
        if (description.includes('\n\n')) {
            return description.split('\n\n').map(p => `<p>${p.trim()}</p>`).join('');
        }
        if (description.includes('\n')) {
            return description.split('\n').map(p => `<p>${p.trim()}</p>`).join('');
        }
        return `<p>${description}</p>`;
    }

    if (description.desc) return parseDescription(description.desc);
    return '<p>No description available.</p>';
}

/**
 * Update like button text and class based on liked status.
 * Visual styling is handled entirely in style.css via the .liked class.
 */
function updateLikeButton(liked) {
    const likeBtn = document.getElementById('likeBtn');
    if (!likeBtn) return;

    if (liked) {
        likeBtn.textContent = 'Unlike Spell';
        likeBtn.classList.add('liked');
    } else {
        likeBtn.textContent = ' Like Spell';
        likeBtn.classList.remove('liked');
    }
}

// Display

function displaySpell(spell) {
    hideError();

    if (!spell) {
        showError('No spell data received');
        return;
    }

    // Store spell in state so like/delete buttons can reference its index
    currentSpell = spell;

    const spellName    = document.getElementById('spellName');
    const spellDesc    = document.getElementById('spellDescription');
    const spellActions = document.getElementById('spellActions');

    if (spellName) spellName.textContent = spell.name || 'Unknown Spell';

    if (spellDesc) {
        let html = '';
        if (spell.description)            html = parseDescription(spell.description);
        else if (spell.desc)              html = parseDescription(spell.desc);
        else if (spell.data?.description) html = parseDescription(spell.data.description);
        else if (spell.data?.desc)        html = parseDescription(spell.data.desc);
        else {
            for (const prop of ['description', 'desc', 'text', 'content']) {
                if (spell[prop]) { html = parseDescription(spell[prop]); break; }
            }
        }
        spellDesc.innerHTML = html || '<p>No description available for this spell.</p>';
    }

    // Reflect this spell's current liked status on the button
    updateLikeButton(spell.liked || false);

    // .visible class defined in style.css switches display from none to flex
    if (spellActions) spellActions.classList.add('visible');
}

//READ 

async function fetchDailySpell() {
    if (isLoading) return;

    try {
        setLoading(true);
        hideError();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${API_BASE_URL}/daily-spell`, {
            signal:  controller.signal,
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            mode:    'cors'
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            if (response.status === 404) throw new Error('Daily spell endpoint not found. Is the backend running?');
            else if (response.status === 500) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.message || 'Server error - please try again later');
            }
            else if (response.status === 503) throw new Error('Service unavailable - please try again later');
            else if (response.status === 429) throw new Error('Too many requests - please wait a moment');
            else throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        if (result.success) {
            const spell = result.spell || result.data || result;
            if (spell) {
                displaySpell(spell);
                console.log('Successfully loaded spell:', spell.name);
            } else {
                throw new Error('No spell data received');
            }
        } else {
            throw new Error(result.message || result.error || 'Failed to fetch spell');
        }
    } catch (error) {
        console.error('Error fetching spell:', error);

        let msg = '';
        if (error.name === 'AbortError') msg = 'Request timed out. Please check your connection and try again.';
        else if (error.message.includes('Failed to fetch')) msg = 'Cannot connect to server. Make sure the backend is running on port 5000.';
        else if (error.message.includes('NetworkError')) msg = 'Network error. Please check your internet connection.';
        else msg = error.message || 'Failed to load daily spell. Please try again later.';

        showError(msg);
        tryLoadFromCache();
    } finally {
        setLoading(false);
    }
}

// UPDATE (like)

async function likeCurrentSpell() {
    const likeBtn = document.getElementById('likeBtn');

    if (!currentSpell || !currentSpell.index) {
        alert('No spell loaded to like.');
        return;
    }

    // Toggle: if already liked, unlike instead
    if (currentSpell.liked) {
        await unlikeCurrentSpell();
        return;
    }

    try {
        if (likeBtn) likeBtn.disabled = true;

        const response = await fetch(`${API_BASE_URL}/spells/${currentSpell.index}/like`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            mode:    'cors'
        });

        const result = await response.json();

        if (result.success) {
            currentSpell.liked = true;
            updateLikeButton(true);
            showToast(`${result.spell.name} liked!`);
        } else {
            alert(result.message || 'Failed to like spell.');
        }
    } catch (error) {
        console.error('Error liking spell:', error);
        alert('Could not connect to server to like spell.');
    } finally {
        if (likeBtn) likeBtn.disabled = false;
    }
}

// UPDATE (unlike)

async function unlikeCurrentSpell() {
    const likeBtn = document.getElementById('likeBtn');
    if (!currentSpell || !currentSpell.index) return;

    try {
        if (likeBtn) likeBtn.disabled = true;

        const response = await fetch(`${API_BASE_URL}/spells/${currentSpell.index}/like`, {
            method:  'DELETE',
            headers: { 'Content-Type': 'application/json' },
            mode:    'cors'
        });

        const result = await response.json();

        if (result.success) {
            currentSpell.liked = false;
            updateLikeButton(false);
            showToast(`${result.spell.name} unliked.`);
        } else {
            alert(result.message || 'Failed to unlike spell.');
        }
    } catch (error) {
        console.error('Error unliking spell:', error);
        alert('Could not connect to server to unlike spell.');
    } finally {
        if (likeBtn) likeBtn.disabled = false;
    }
}

// DELETE 

async function deleteCurrentSpell() {
    const deleteBtn    = document.getElementById('deleteBtn');
    const spellName    = document.getElementById('spellName');
    const spellDesc    = document.getElementById('spellDescription');
    const spellActions = document.getElementById('spellActions');

    if (!currentSpell || !currentSpell.index) {
        alert('No spell loaded to delete.');
        return;
    }

    const confirmed = confirm(`Are you sure you want to delete "${currentSpell.name}" from the spellbook? This cannot be undone.`);
    if (!confirmed) return;

    try {
        if (deleteBtn) deleteBtn.disabled = true;

        const response = await fetch(`${API_BASE_URL}/spells/${currentSpell.index}`, {
            method:  'DELETE',
            headers: { 'Content-Type': 'application/json' },
            mode:    'cors'
        });

        const result = await response.json();

        if (result.success) {
            showToast(`${result.message}`);
            currentSpell = null;

            // Hide like/delete buttons — no spell is active
            if (spellActions) spellActions.classList.remove('visible');

            // Update card to reflect deletion
            if (spellName) spellName.textContent = 'Spell Deleted';
            if (spellDesc) spellDesc.innerHTML   = '<p>This spell has been removed from the spellbook. Refresh for a new spell.</p>';

            // Clear local cache since the spell no longer exists in the DB
            localStorage.removeItem('lastSpell');
            localStorage.removeItem('lastSpellTime');
        } else {
            alert(result.message || 'Failed to delete spell.');
        }
    } catch (error) {
        console.error('Error deleting spell:', error);
        alert('Could not connect to server to delete spell.');
    } finally {
        if (deleteBtn) deleteBtn.disabled = false;
    }
}

// Toast notification 

function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Small delay lets the browser register the element before the CSS transition fires
    setTimeout(() => toast.classList.add('toast-visible'), 10);
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

//Offline cache 

function tryLoadFromCache() {
    try {
        const cached    = localStorage.getItem('lastSpell');
        const cacheTime = localStorage.getItem('lastSpellTime');

        if (cached && cacheTime && (Date.now() - parseInt(cacheTime)) < 24 * 60 * 60 * 1000) {
            console.log('Loading cached spell as fallback');
            displaySpell(JSON.parse(cached));

            // Add offline banner if it isn't already present
            if (!document.querySelector('.cache-note')) {
                const note = document.createElement('div');
                // .cache-note is styled in style.css
                note.className   = 'cache-note';
                note.textContent = 'Showing previously loaded spell (offline mode)';
                const actionSection = document.querySelector('.action-section');
                if (actionSection) actionSection.insertBefore(note, actionSection.firstChild);
            }
        }
    } catch (e) {
        console.error('Error loading from cache:', e);
    }
}

function cacheCurrentSpell(spell) {
    try {
        localStorage.setItem('lastSpell', JSON.stringify(spell));
        localStorage.setItem('lastSpellTime', Date.now().toString());
    } catch (e) {
        console.error('Error caching spell:', e);
    }
}

// Wrap displaySpell to also persist to cache each time a spell is shown
const _displaySpell = displaySpell;
displaySpell = function (spell) {
    _displaySpell(spell);
    if (spell && spell.name) cacheCurrentSpell(spell);
};

// Midnight auto-refresh 

function setupMidnightRefresh() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const delay = midnight - now;

    if (delay > 0) {
        setTimeout(() => {
            console.log('Midnight refresh — fetching new spell');
            fetchDailySpell();
            setupMidnightRefresh();
        }, delay);
    }
}

// Init & event listeners 

function init() {
    console.log('Initializing spell app...');
    tryLoadFromCache();
    fetchDailySpell();
    setupMidnightRefresh();
}

document.addEventListener('DOMContentLoaded', () => {
    // All listeners registered here — DOM is guaranteed to be ready

    document.getElementById('refreshBtn')?.addEventListener('click', () => {
        document.querySelector('.cache-note')?.remove();
        fetchDailySpell();
    });

    document.getElementById('retryBtn')?.addEventListener('click', () => {
        document.querySelector('.cache-note')?.remove();
        fetchDailySpell();
    });

    document.getElementById('likeBtn')?.addEventListener('click', likeCurrentSpell);
    document.getElementById('deleteBtn')?.addEventListener('click', deleteCurrentSpell);

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
            e.preventDefault();
            fetchDailySpell();
        }
    });

    init();
});

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fetchDailySpell, displaySpell, parseDescription, likeCurrentSpell, unlikeCurrentSpell, deleteCurrentSpell };
}