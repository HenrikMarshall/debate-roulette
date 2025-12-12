// api-routes.js
// Add these routes to your Express server

const express = require('express');
const router = express.Router();

// Import shared queue from server (will be set by server.js)
let waitingUsers, activeDebates, userSockets, io;

// This will be called by server.js to inject dependencies
router.setDependencies = (deps) => {
    waitingUsers = deps.waitingUsers;
    activeDebates = deps.activeDebates;
    userSockets = deps.userSockets;
    io = deps.io;
};

// In-memory storage for API-only users
const activeUsers = new Map(); // userId -> user data

// Debate topics (same as your existing topics array)
const topics = [
    "Artificial Intelligence will do more harm than good for humanity",
    "Social media should be regulated like tobacco products",
    "Universal Basic Income is necessary for the future economy",
    "Space exploration is a waste of resources",
    "Cryptocurrency is the future of money",
    "Remote work is better than office work",
    "College education is overrated",
    "Animals should have legal rights",
    "Nuclear energy is essential for fighting climate change",
    "Video games cause violence",
    "Privacy is more important than security",
    "Homework should be banned in schools",
    "Self-driving cars will make roads safer",
    "Vegetarianism should be mandatory",
    "Advertising to children should be illegal",
    "Athletes are overpaid",
    "Artificial meat is better than real meat",
    "Democracy is the best form of government",
    "Books are better than movies",
    "Technology makes us more lonely"
];

// Helper function to generate IDs
function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Helper function to get random topic
function getRandomTopic() {
    const topic = topics[Math.floor(Math.random() * topics.length)];
    return {
        id: generateId('topic'),
        text: topic,
        category: 'general'
    };
}

// ==========================================
// AUTHENTICATION ENDPOINTS
// ==========================================

// Anonymous login (no account needed)
router.post('/auth/login', (req, res) => {
    const { email, password } = req.body;
    
    // For now, accept any login or create anonymous session
    const userId = email ? `user_${email}` : generateId('anon');
    const sessionToken = generateId('session');
    
    const user = {
        id: userId,
        username: email ? email.split('@')[0] : 'Anonymous',
        email: email || null,
        stats: {
            totalDebates: 0,
            wins: 0,
            losses: 0,
            winRate: 0
        }
    };
    
    activeUsers.set(userId, user);
    
    res.json({
        token: sessionToken,
        user: user
    });
});

// ==========================================
// DEBATE ENDPOINTS
// ==========================================

// Find an opponent for debate
router.post('/debates/find-opponent', (req, res) => {
    const userId = req.body.userId || generateId('user');
    const username = req.body.username || 'Anonymous';
    
    // Create user entry
    const user = {
        id: userId,
        username: username,
        joinedAt: new Date()
    };
    
    // Check if someone is waiting in the WebSocket queue
    if (waitingUsers && waitingUsers.size > 0) {
        // Get the first waiting user from WebSocket
        const waitingSocketId = Array.from(waitingUsers)[0];
        const opponent = userSockets ? userSockets.get(waitingSocketId) : null;

        if (opponent && io) {
            // Remove from WebSocket queue
            waitingUsers.delete(waitingSocketId);
            
            // Create debate
            const debateId = generateId('debate');
            const topic = getRandomTopic();
            
            // Randomly assign sides
            const user1Side = Math.random() > 0.5 ? 'for' : 'against';
            const user2Side = user1Side === 'for' ? 'against' : 'for';

            const debate = {
                id: debateId,
                topic: topic.text,
                user1: {
                    id: waitingSocketId,
                    username: opponent.username || 'Web User',
                    side: user1Side
                },
                user2: {
                    id: userId,
                    username: username,
                    side: user2Side
                },
                currentSpeaker: waitingSocketId,
                phase: 'speaker1',
                startedAt: Date.now(),
                spectators: new Set(),
                participants: [
                    {
                        id: waitingSocketId,
                        username: opponent.username || 'Web User',
                        isSpeaker1: true
                    },
                    {
                        id: userId,
                        username: username,
                        isSpeaker1: false
                    }
                ]
            };

            activeDebates.set(debateId, debate);

            // Update opponent data
            opponent.currentDebate = debateId;
            opponent.side = user1Side;

            // Notify WebSocket user
            io.to(waitingSocketId).emit('debate-matched', {
                debateId: debateId,
                topic: topic.text,
                opponent: username,
                yourSide: user1Side,
                currentSpeaker: waitingSocketId
            });

            console.log(`🎭 Cross-platform match! WebSocket user ${opponent.username} + API user ${username}`);
            
            // Return match to API user
            return res.json(debate);
        }
    }
    
    // No WebSocket users waiting, add to our own tracking
    // (WebSocket users will see this API user in their queue)
    activeUsers.set(userId, user);
    
    // Return waiting status
    res.json({
        status: 'waiting',
        message: 'Searching for opponent...',
        queuePosition: 1
    });
});

// Get debate by ID
router.get('/debates/:debateId', (req, res) => {
    const debate = activeDebates.get(req.params.debateId);
    
    if (!debate) {
        return res.status(404).json({ error: 'Debate not found' });
    }
    
    res.json(debate);
});

// Get live debates (for spectator mode)
router.get('/debates/live', (req, res) => {
    const liveDebates = Array.from(activeDebates.values())
        .filter(d => d.phase !== 'finished')
        .slice(0, 20) // Limit to 20
        .map(d => ({
            id: d.id,
            topic: d.topic.text,
            spectators: Math.floor(Math.random() * 50) + 5, // Mock for now
            duration: Math.floor((new Date() - new Date(d.startedAt)) / 1000),
            votes: {
                speaker1: Math.floor(Math.random() * 30),
                speaker2: Math.floor(Math.random() * 30)
            }
        }));
    
    res.json(liveDebates);
});

// ==========================================
// TOPIC ENDPOINTS
// ==========================================

// Get random topic
router.get('/topics/random', (req, res) => {
    res.json(getRandomTopic());
});

// Get all topics
router.get('/topics', (req, res) => {
    const allTopics = topics.map((text, index) => ({
        id: `topic_${index}`,
        text: text,
        category: 'general'
    }));
    
    res.json(allTopics);
});

// ==========================================
// USER ENDPOINTS
// ==========================================

// Get user profile
router.get('/users/:userId', (req, res) => {
    const user = activeUsers.get(req.params.userId);
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
});

// Update user stats
router.patch('/users/:userId/stats', (req, res) => {
    const user = activeUsers.get(req.params.userId);
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    // Update stats
    if (req.body.win !== undefined) {
        user.stats.totalDebates++;
        if (req.body.win) {
            user.stats.wins++;
        } else {
            user.stats.losses++;
        }
        user.stats.winRate = user.stats.wins / user.stats.totalDebates;
    }
    
    activeUsers.set(req.params.userId, user);
    
    res.json(user);
});

// ==========================================
// STATS/HEALTH ENDPOINTS
// ==========================================

// Health check
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date(),
        stats: {
            activeUsers: activeUsers.size,
            matchQueue: matchQueue.size,
            activeDebates: activeDebates.size
        }
    });
});

module.exports = router;
