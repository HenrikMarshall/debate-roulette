const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes - BEFORE static middleware to take precedence
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/data-deletion', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'data-deletion.html'));
});

app.get('/debate', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Static files - comes AFTER routes
app.use(express.static('public'));

// State management
const waitingUsers = new Set(); // Non-premium users
const premiumQueues = new Map(); // Category-specific queues: category -> Set of socket IDs
const activeDebates = new Map(); // debateId -> { user1, user2, topic, currentSpeaker, timeStarted, spectators: [], votes: {} }
const userSockets = new Map(); // socketId -> userData
const spectatorRooms = new Map(); // socketId -> debateId (for tracking which debate spectator is watching)

// ═══════════════════════════════════════════════════════════
// SAFETY INFRASTRUCTURE
// ═══════════════════════════════════════════════════════════
const userReports = new Map(); // socketId -> [{reporterId, reason, timestamp, topic}]
const bannedUsers = new Map(); // socketId -> {bannedUntil, reportCount, reasons[]}
const blockedPairs = new Map(); // userId -> Set of blocked userIds

// Auto-ban thresholds
const REPORT_THRESHOLD = 3; // Reports within 24hrs
const REPORT_WINDOW = 24 * 60 * 60 * 1000; // 24 hours in ms
const BAN_DURATION = 24 * 60 * 60 * 1000; // 24 hour ban

// Helper: Check if user is banned
function isUserBanned(socketId) {
    if (!bannedUsers.has(socketId)) return false;
    
    const banInfo = bannedUsers.get(socketId);
    const now = Date.now();
    
    // Check if ban expired
    if (now > banInfo.bannedUntil) {
        bannedUsers.delete(socketId);
        console.log(`⏰ Ban expired for: ${socketId}`);
        return false;
    }
    
    return true;
}

// Helper: Get active reports within 24hrs
function getRecentReports(socketId) {
    if (!userReports.has(socketId)) return [];
    
    const now = Date.now();
    const reports = userReports.get(socketId);
    
    return reports.filter(report => {
        const reportTime = new Date(report.timestamp).getTime();
        return (now - reportTime) < REPORT_WINDOW;
    });
}

// Helper: Process report and auto-ban if threshold reached
function processReport(socketId, report) {
    // Add report
    if (!userReports.has(socketId)) {
        userReports.set(socketId, []);
    }
    userReports.get(socketId).push(report);
    
    // Check recent reports
    const recentReports = getRecentReports(socketId);
    
    console.log(`📊 User ${socketId} has ${recentReports.length} reports in last 24hrs`);
    
    // Auto-ban if threshold reached
    if (recentReports.length >= REPORT_THRESHOLD) {
        const bannedUntil = Date.now() + BAN_DURATION;
        const reasons = recentReports.map(r => r.reason);
        
        bannedUsers.set(socketId, {
            bannedUntil: bannedUntil,
            reportCount: recentReports.length,
            reasons: reasons,
            bannedAt: new Date().toISOString()
        });
        
        console.log(`🚫 AUTO-BAN: User ${socketId} banned for 24hrs (${recentReports.length} reports)`);
        
        // Disconnect the user
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
            socket.emit('banned', {
                reason: 'Multiple reports received',
                bannedUntil: new Date(bannedUntil).toISOString(),
                reportCount: recentReports.length
            });
            socket.disconnect(true);
        }
        
        return true; // User was banned
    }
    
    return false; // User not banned (yet)
}

// Helper: Check if two users have blocked each other
function areUsersBlocked(userId1, userId2) {
    if (blockedPairs.has(userId1)) {
        if (blockedPairs.get(userId1).has(userId2)) {
            return true;
        }
    }
    if (blockedPairs.has(userId2)) {
        if (blockedPairs.get(userId2).has(userId1)) {
            return true;
        }
    }
    return false;
}

// Debate topics organized by category - 100 controversial topics
const topicsByCategory = {
    'Technology & AI': [
        "Artificial Intelligence will do more harm than good for humanity",
        "Social media should be regulated like tobacco products",
        "Cryptocurrency is the future of money",
        "Self-driving cars will make roads safer",
        "Technology makes us more lonely",
        "Video games cause violence",
        "The internet was a mistake for society",
        "Robots will replace most human jobs within 20 years",
        "Privacy is dead in the digital age and we should accept it",
        "Smartphones have ruined an entire generation",
        "Big Tech companies should be broken up",
        "TikTok should be banned worldwide",
        "Elon Musk is overrated as a visionary",
        "The Metaverse is a scam",
        "NFTs are worthless digital garbage"
    ],
    
    'Politics & Government': [
        "Democracy is the best form of government",
        "Voting should be mandatory for all citizens",
        "The voting age should be lowered to 16",
        "Politicians should have strict term limits",
        "Billionaires should not exist",
        "Capitalism is broken beyond repair",
        "Communism could work if done correctly",
        "Monarchy is an outdated form of government",
        "The death penalty should be abolished worldwide",
        "Gun ownership is a fundamental human right",
        "All guns should be banned completely",
        "National borders should be abolished",
        "Patriotism is just nationalism in disguise",
        "The United Nations is completely useless",
        "Lobbying is just legalized corruption"
    ],
    
    'Social Issues': [
        "Cancel culture has gone too far",
        "Political correctness is destroying free speech",
        "Reparations for slavery should be paid today",
        "Affirmative action is reverse discrimination",
        "Men and women are fundamentally different",
        "Gender is purely a social construct",
        "There are only two biological genders",
        "Cultural appropriation is not real",
        "Beauty pageants should be banned",
        "Plastic surgery is a form of self-harm",
        "Being an influencer is not a real job",
        "Trophy hunting should be illegal worldwide",
        "Zoos are just animal prisons",
        "Eating meat is morally wrong",
        "Veganism is elitist and classist"
    ],
    
    'Education & Work': [
        "College education is overrated and overpriced",
        "All student debt should be forgiven",
        "Homework should be banned in schools",
        "Standardized testing is harmful to students",
        "Everyone should be required to learn coding",
        "Liberal arts degrees are worthless",
        "Teachers are overpaid for the work they do",
        "Remote work is better than office work",
        "The 4-day work week should be standard",
        "Unpaid internships should be illegal",
        "Tipping culture needs to end",
        "CEOs are paid way too much",
        "Labor unions have outlived their usefulness",
        "Child labor laws are too strict"
    ],
    
    'Economics & Money': [
        "Universal Basic Income is necessary for the future",
        "The rich don't pay their fair share",
        "Inheritance should be heavily taxed",
        "Raising minimum wage increases unemployment",
        "Housing is a fundamental human right",
        "Landlords are parasites on society",
        "Credit scores are modern-day discrimination",
        "The stock market is just legalized gambling",
        "Money can buy happiness",
        "Expensive weddings are a waste of money"
    ],
    
    'Environment & Science': [
        "Climate change is the biggest threat to humanity",
        "Nuclear energy is essential for fighting climate change",
        "Space exploration is a waste of resources",
        "Colonizing Mars is humanity's destiny",
        "GMO foods are safe and necessary",
        "Organic food is a marketing scam",
        "Recycling is mostly pointless theater",
        "Having children is environmentally irresponsible",
        "Population control is necessary",
        "Animal testing is never justified"
    ],
    
    'Health & Medicine': [
        "Healthcare is a human right",
        "Pharmaceutical companies are fundamentally evil",
        "Alternative medicine is mostly quackery",
        "Mental illness is overdiagnosed today",
        "Therapy is overrated and ineffective",
        "Antidepressants are dangerously overprescribed",
        "Drug addiction is a choice not a disease",
        "The war on drugs was a complete failure",
        "All drugs should be decriminalized",
        "Cigarettes should be banned completely",
        "Alcohol is worse for society than marijuana",
        "Psychedelics should be legal for therapeutic use"
    ],
    
    'Family & Relationships': [
        "Marriage is an outdated institution",
        "Monogamy is unnatural for humans",
        "Divorce is too easy nowadays",
        "Parents should be licensed before having kids",
        "Spanking children is child abuse",
        "Homeschooling should be illegal",
        "Having kids in today's world is selfish",
        "Adoption is better than biological children",
        "Large age gaps in relationships are predatory",
        "Prenuptial agreements show lack of trust"
    ],
    
    'Media & Entertainment': [
        "Books are better than movies and TV",
        "Modern art is pretentious garbage",
        "Rap music is degrading to society",
        "Reality TV is rotting people's brains",
        "Streaming services are killing cinema",
        "Piracy is justified when content is overpriced",
        "Professional athletes are overpaid",
        "Celebrities should stay out of politics",
        "Paparazzi photography should be illegal"
    ]
};

// Flatten all topics for random selection (non-premium users)
const topics = Object.values(topicsByCategory).flat();

// Get available categories
const categories = Object.keys(topicsByCategory);

// Generate random debate ID
function generateDebateId() {
    return `debate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Get random topic (for non-premium users)
function getRandomTopic() {
    return topics[Math.floor(Math.random() * topics.length)];
}

// Get random topic from specific category (for premium users)
function getCategoryTopic(category) {
    const categoryTopics = topicsByCategory[category];
    if (!categoryTopics || categoryTopics.length === 0) {
        return getRandomTopic(); // Fallback to random
    }
    return categoryTopics[Math.floor(Math.random() * categoryTopics.length)];
}

// Get topic by category (PRO feature)
function getTopicByCategory(category) {
    const categoryMap = {
        'politics': [
            'Capitalism is broken and needs to be replaced',
            'Democracy is failing in the modern world',
            'Social media should be regulated by government',
            'Universal basic income would solve poverty',
            'Voting should be mandatory',
        ],
        'technology': [
            'AI will destroy more jobs than it creates',
            'Social media does more harm than good',
            'Privacy is dead in the digital age',
            'Cryptocurrency is the future of money',
            'TikTok should be banned worldwide',
        ],
        'social': [
            'Cancel culture has gone too far',
            'Political correctness is destroying free speech',
            'Religion does more harm than good',
            'Marriage is an outdated institution',
            'Having children is selfish in 2024',
        ],
        'culture': [
            'Modern art is pretentious garbage',
            'Movies are better than books',
            'Pineapple belongs on pizza',
            'Video games are a waste of time',
            'Reality TV is ruining society',
        ],
        'economics': [
            'Billionaires should not exist',
            'College should be free for everyone',
            'Minimum wage should be $25/hour',
            'Landlords are parasites',
            'Tipping culture needs to end',
        ],
        'environment': [
            'Climate change is exaggerated',
            'Nuclear power is the solution',
            'Veganism is the only ethical diet',
            'Population control is necessary',
            'Recycling is mostly a scam',
        ]
    };
    
    const categoryTopics = categoryMap[category] || topics;
    return categoryTopics[Math.floor(Math.random() * categoryTopics.length)];
}

// Get random side
function getRandomSide() {
    return Math.random() > 0.5 ? 'PRO' : 'CON';
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Store user info
    userSockets.set(socket.id, {
        socketId: socket.id,
        connectedAt: Date.now(),
        currentDebate: null
    });

    // User requests to find opponent
    socket.on('find-opponent', () => {
        console.log(`${socket.id} is looking for opponent`);

        // Check if user is banned
        if (isUserBanned(socket.id)) {
            const banInfo = bannedUsers.get(socket.id);
            const timeLeft = Math.ceil((banInfo.bannedUntil - Date.now()) / (1000 * 60)); // minutes
            
            socket.emit('banned', {
                reason: 'Multiple reports received',
                bannedUntil: new Date(banInfo.bannedUntil).toISOString(),
                reportCount: banInfo.reportCount,
                timeLeftMinutes: timeLeft
            });
            
            console.log(`🚫 Banned user ${socket.id} tried to find opponent (${timeLeft} mins left)`);
            return;
        }

        // Check if already in queue
        if (waitingUsers.has(socket.id)) {
            socket.emit('error', { message: 'Already in queue' });
            return;
        }

        // Check if already in debate
        const userData = userSockets.get(socket.id);
        if (userData.currentDebate) {
            socket.emit('error', { message: 'Already in a debate' });
            return;
        }

        // Add to waiting queue
        waitingUsers.add(socket.id);

        // Try to match with another waiting user
        if (waitingUsers.size >= 2) {
            // Get two users from queue
            const usersArray = Array.from(waitingUsers);
            let user1Id = usersArray[0];
            let user2Id = usersArray[1];
            
            // Check if users have blocked each other
            const user1Data = userSockets.get(user1Id);
            const user2Data = userSockets.get(user2Id);
            
            // Simple block check using socket IDs
            // In production, you'd use user IDs from authentication
            if (areUsersBlocked(user1Id, user2Id)) {
                console.log(`🚫 Users ${user1Id} and ${user2Id} are blocked - skipping match`);
                // Keep both in queue, they'll match with next available user
                return;
            }

            // Remove from queue
            waitingUsers.delete(user1Id);
            waitingUsers.delete(user2Id);

            // Create debate
            const debateId = generateDebateId();
            const topic = getRandomTopic();
            const user1Side = getRandomSide();
            const user2Side = user1Side === 'PRO' ? 'CON' : 'PRO';
            const firstSpeaker = Math.random() > 0.5 ? user1Id : user2Id;

            const debate = {
                id: debateId,
                user1: user1Id,
                user2: user2Id,
                topic: topic,
                user1Side: user1Side,
                user2Side: user2Side,
                currentSpeaker: firstSpeaker,
                phase: 'opening', // 'opening', 'response', 'open-debate'
                startedAt: Date.now(),
                round: 1,
                lastFirstSpeaker: firstSpeaker, // Track who went first to alternate
                spectators: [], // Array of spectator socket IDs
                votes: {}, // { socketId: 'user1' or 'user2' }
                chatMessages: [] // Spectator chat messages
            };

            activeDebates.set(debateId, debate);

            // Update user data
            userSockets.get(user1Id).currentDebate = debateId;
            userSockets.get(user2Id).currentDebate = debateId;

            // Join both users to a room
            io.sockets.sockets.get(user1Id)?.join(debateId);
            io.sockets.sockets.get(user2Id)?.join(debateId);

            // Notify both users
            io.to(user1Id).emit('debate-matched', {
                debateId: debateId,
                opponentId: user2Id,
                topic: topic,
                yourSide: user1Side,
                firstSpeaker: firstSpeaker,
                youGoFirst: firstSpeaker === user1Id,
                round: 1
            });

            io.to(user2Id).emit('debate-matched', {
                debateId: debateId,
                opponentId: user1Id,
                topic: topic,
                yourSide: user2Side,
                firstSpeaker: firstSpeaker,
                youGoFirst: firstSpeaker === user2Id,
                round: 1
            });

            console.log(`Debate created: ${debateId} - ${user1Id} vs ${user2Id}`);
        } else {
            socket.emit('searching', { message: 'Searching for opponent...' });
        }
    });

    // ═══════════════════════════════════════════════════════════
    // PREMIUM: CATEGORY-BASED MATCHMAKING
    // ═══════════════════════════════════════════════════════════
    socket.on('find-opponent-premium', (data) => {
        const { category, isPremium } = data;
        console.log(`${socket.id} looking for opponent - Category: ${category}, Premium: ${isPremium}`);

        // Check if user is banned
        if (isUserBanned(socket.id)) {
            const banInfo = bannedUsers.get(socket.id);
            const timeLeft = Math.ceil((banInfo.bannedUntil - Date.now()) / (1000 * 60));
            socket.emit('banned', {
                reason: 'Multiple reports received',
                bannedUntil: new Date(banInfo.bannedUntil).toISOString(),
                reportCount: banInfo.reportCount,
                timeLeftMinutes: timeLeft
            });
            return;
        }

        // Check if already in any queue
        if (waitingUsers.has(socket.id)) {
            socket.emit('error', { message: 'Already in queue' });
            return;
        }
        for (const queue of premiumQueues.values()) {
            if (queue.has(socket.id)) {
                socket.emit('error', { message: 'Already in queue' });
                return;
            }
        }

        // Check if already in debate
        const userData = userSockets.get(socket.id);
        if (userData.currentDebate) {
            socket.emit('error', { message: 'Already in a debate' });
            return;
        }

        // Premium user with valid category
        if (isPremium && category && topicsByCategory[category]) {
            console.log(`👑 Premium: ${socket.id} → ${category} queue`);
            
            if (!premiumQueues.has(category)) {
                premiumQueues.set(category, new Set());
            }
            const categoryQueue = premiumQueues.get(category);
            categoryQueue.add(socket.id);

            // Try premium-to-premium match first
            if (categoryQueue.size >= 2) {
                const usersArray = Array.from(categoryQueue);
                const user1Id = usersArray[0];
                const user2Id = usersArray[1];

                if (areUsersBlocked(user1Id, user2Id)) {
                    console.log(`🚫 Blocked: ${user1Id} ↔ ${user2Id}`);
                    return;
                }

                categoryQueue.delete(user1Id);
                categoryQueue.delete(user2Id);

                createDebateWithCategory(user1Id, user2Id, category, true);
            }
            // Try premium-to-nonpremium match
            else if (waitingUsers.size > 0) {
                const nonPremiumId = Array.from(waitingUsers)[0];

                if (areUsersBlocked(socket.id, nonPremiumId)) {
                    socket.emit('searching', { message: `Searching ${category}...` });
                    return;
                }

                categoryQueue.delete(socket.id);
                waitingUsers.delete(nonPremiumId);

                createDebateWithCategory(socket.id, nonPremiumId, category, false);
            } else {
                socket.emit('searching', { message: `Searching ${category}...` });
            }
        } 
        // Non-premium: regular queue
        else {
            waitingUsers.add(socket.id);

            if (waitingUsers.size >= 2) {
                const usersArray = Array.from(waitingUsers);
                const user1Id = usersArray[0];
                const user2Id = usersArray[1];

                if (areUsersBlocked(user1Id, user2Id)) {
                    return;
                }

                waitingUsers.delete(user1Id);
                waitingUsers.delete(user2Id);

                createDebateWithCategory(user1Id, user2Id, null, false);
            } else {
                socket.emit('searching', { message: 'Searching...' });
            }
        }
    });

    // Helper function to create debates
    function createDebateWithCategory(user1Id, user2Id, category, isPremiumDebate) {
        const debateId = generateDebateId();
        const topic = category ? getCategoryTopic(category) : getRandomTopic();
        const user1Side = getRandomSide();
        const user2Side = user1Side === 'PRO' ? 'CON' : 'PRO';
        const firstSpeaker = Math.random() > 0.5 ? user1Id : user2Id;

        const debate = {
            id: debateId,
            user1: user1Id,
            user2: user2Id,
            topic: topic,
            category: category || 'Random',
            user1Side: user1Side,
            user2Side: user2Side,
            firstSpeaker: firstSpeaker,
            currentSpeaker: firstSpeaker,
            round: 1,
            timeStarted: Date.now(),
            spectators: [],
            votes: { user1: 0, user2: 0 },
            isPremiumDebate: isPremiumDebate
        };

        activeDebates.set(debateId, debate);
        userSockets.get(user1Id).currentDebate = debateId;
        userSockets.get(user2Id).currentDebate = debateId;

        io.sockets.sockets.get(user1Id)?.join(debateId);
        io.sockets.sockets.get(user2Id)?.join(debateId);

        io.to(user1Id).emit('debate-matched', {
            debateId: debateId,
            opponentId: user2Id,
            topic: topic,
            category: category || 'Random',
            yourSide: user1Side,
            firstSpeaker: firstSpeaker,
            youGoFirst: firstSpeaker === user1Id,
            round: 1,
            isPremiumDebate: isPremiumDebate
        });

        io.to(user2Id).emit('debate-matched', {
            debateId: debateId,
            opponentId: user1Id,
            topic: topic,
            category: category || 'Random',
            yourSide: user2Side,
            firstSpeaker: firstSpeaker,
            youGoFirst: firstSpeaker === user2Id,
            round: 1,
            isPremiumDebate: isPremiumDebate
        });

        const emoji = isPremiumDebate ? '👑👑' : category ? '👑' : '';
        console.log(`${emoji} Debate: ${debateId} - ${category || 'Random'} - ${user1Id} vs ${user2Id}`);
    }

    // WebRTC signaling
    socket.on('webrtc-offer', ({ debateId, offer }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        // Forward offer to opponent
        const opponentId = debate.user1 === socket.id ? debate.user2 : debate.user1;
        io.to(opponentId).emit('webrtc-offer', { offer, from: socket.id });
    });

    socket.on('webrtc-answer', ({ debateId, answer }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        // Forward answer to opponent
        const opponentId = debate.user1 === socket.id ? debate.user2 : debate.user1;
        io.to(opponentId).emit('webrtc-answer', { answer, from: socket.id });
    });

    socket.on('webrtc-ice-candidate', ({ debateId, candidate }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        // Forward ICE candidate to opponent
        const opponentId = debate.user1 === socket.id ? debate.user2 : debate.user1;
        io.to(opponentId).emit('webrtc-ice-candidate', { candidate, from: socket.id });
    });

    // Turn completed
    socket.on('turn-completed', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) {
            console.log('turn-completed: debate not found:', debateId);
            return;
        }

        console.log(`turn-completed received for ${debateId}, phase: ${debate.phase}`);

        // Prevent duplicate turn-completed within 1 second
        const now = Date.now();
        if (debate.lastTurnCompleted && now - debate.lastTurnCompleted < 1000) {
            console.log('Ignoring duplicate turn-completed');
            return;
        }
        debate.lastTurnCompleted = now;

        if (debate.phase === 'opening') {
            // First person spoke, now second person's turn
            debate.phase = 'response';
            debate.currentSpeaker = debate.currentSpeaker === debate.user1 ? debate.user2 : debate.user1;
            
            console.log(`Switching to response phase, new speaker: ${debate.currentSpeaker}`);
            
            io.to(debateId).emit('turn-change', {
                currentSpeaker: debate.currentSpeaker,
                phase: 'response'
            });
        } else if (debate.phase === 'response') {
            // Both spoke, start open debate
            debate.phase = 'open-debate';
            debate.currentSpeaker = null;
            
            console.log('Starting open debate');
            
            io.to(debateId).emit('open-debate-start');
            
            // Start voting for spectators (30 seconds - duration of open debate)
            if (debate.spectators && debate.spectators.length > 0) {
                // Reset votes for this round
                debate.votes = {};
                
                debate.spectators.forEach(spectatorId => {
                    io.to(spectatorId).emit('voting-start', {
                        round: debate.round,
                        duration: 30
                    });
                });
                
                console.log(`Voting started for ${debate.spectators.length} spectators`);
            }
        }
    });

    // Skip topic
    socket.on('skip-topic', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        const newTopic = getRandomTopic();
        debate.topic = newTopic;
        debate.round = (debate.round || 1) + 1;

        // Reset to opening phase
        debate.phase = 'opening';
        debate.currentSpeaker = Math.random() > 0.5 ? debate.user1 : debate.user2;

        io.to(debate.user1).emit('topic-changed', {
            topic: newTopic,
            round: debate.round,
            firstSpeaker: debate.currentSpeaker,
            youGoFirst: debate.currentSpeaker === debate.user1
        });

        io.to(debate.user2).emit('topic-changed', {
            topic: newTopic,
            round: debate.round,
            firstSpeaker: debate.currentSpeaker,
            youGoFirst: debate.currentSpeaker === debate.user2
        });
    });

    // Request new topic (after open debate ends)
    socket.on('request-new-topic', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        // Prevent duplicate requests - check if already in transitioning
        if (debate.phase === 'transitioning') {
            console.log('Ignoring duplicate request - already transitioning');
            return;
        }

        // Prevent duplicate requests within 2 seconds
        const now = Date.now();
        if (debate.lastTopicRequest && now - debate.lastTopicRequest < 2000) {
            console.log(`Ignoring duplicate new topic request for debate ${debateId}`);
            return;
        }
        debate.lastTopicRequest = now;

        console.log(`New topic requested for debate ${debateId}, current round: ${debate.round || 1}`);

        // No voting delay needed - voting already happened during open debate
        // Proceed immediately to next topic
        debate.phase = 'transitioning';
        proceedToNextTopic(debate, debateId);
    });

    function proceedToNextTopic(debate, debateId) {
        // Prevent double execution
        if (debate.phase === 'opening') {
            console.log('Already moved to next topic, skipping');
            return;
        }

        const newTopic = getRandomTopic();
        debate.topic = newTopic;
        debate.round = (debate.round || 1) + 1;

        // ALTERNATE who goes first
        const newFirstSpeaker = debate.lastFirstSpeaker === debate.user1 ? debate.user2 : debate.user1;
        debate.lastFirstSpeaker = newFirstSpeaker;
        debate.currentSpeaker = newFirstSpeaker;

        console.log(`Round ${debate.round}: ${newFirstSpeaker} goes first (alternating)`);

        // Reset to opening phase
        debate.phase = 'opening';

        io.to(debate.user1).emit('topic-changed', {
            topic: newTopic,
            round: debate.round,
            firstSpeaker: debate.currentSpeaker,
            youGoFirst: debate.currentSpeaker === debate.user1
        });

        io.to(debate.user2).emit('topic-changed', {
            topic: newTopic,
            round: debate.round,
            firstSpeaker: debate.currentSpeaker,
            youGoFirst: debate.currentSpeaker === debate.user2
        });

        // Notify spectators of new topic
        if (debate.spectators) {
            debate.spectators.forEach(spectatorId => {
                io.to(spectatorId).emit('spectator-new-topic', {
                    topic: newTopic,
                    round: debate.round
                });
            });
        }
        
        console.log(`New topic assigned for debate ${debateId}, Round ${debate.round}`);
    }

    // End debate
    socket.on('end-debate', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        // Notify both users
        io.to(debateId).emit('debate-ended');

        // Clean up
        const user1Data = userSockets.get(debate.user1);
        const user2Data = userSockets.get(debate.user2);
        
        if (user1Data) user1Data.currentDebate = null;
        if (user2Data) user2Data.currentDebate = null;

        activeDebates.delete(debateId);
        console.log(`Debate ended: ${debateId}`);
    });

    // Emoji reactions
    socket.on('send-emoji', ({ debateId, emoji }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) return;

        // Forward emoji to opponent
        const opponentId = debate.user1 === socket.id ? debate.user2 : debate.user1;
        io.to(opponentId).emit('emoji-received', { 
            emoji: emoji,
            from: socket.id 
        });
        
        console.log(`Emoji ${emoji} sent in debate ${debateId}`);
    });

    // Spectator Mode - Get list of active debates
    socket.on('get-active-debates', () => {
        const debates = [];
        activeDebates.forEach((debate, debateId) => {
            debates.push({
                id: debateId,
                topic: debate.topic,
                round: debate.round,
                phase: debate.phase,
                spectatorCount: debate.spectators.length,
                startedAt: debate.startedAt
            });
        });
        socket.emit('active-debates-list', debates);
    });

    // Get available debate categories (for premium users)
    socket.on('get-categories', () => {
        socket.emit('categories-list', {
            categories: categories,
            topicCounts: Object.fromEntries(
                Object.entries(topicsByCategory).map(([cat, topics]) => [cat, topics.length])
            )
        });
    });

    // Spectator Mode - Join debate as spectator
    socket.on('join-as-spectator', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (!debate) {
            socket.emit('spectator-error', { message: 'Debate not found' });
            return;
        }

        // Add to spectators
        if (!debate.spectators.includes(socket.id)) {
            debate.spectators.push(socket.id);
        }
        spectatorRooms.set(socket.id, debateId);

        // Send debate info
        socket.emit('spectator-joined', {
            debateId: debateId,
            topic: debate.topic,
            round: debate.round,
            phase: debate.phase,
            spectatorCount: debate.spectators.length,
            chatMessages: debate.chatMessages || [],
            user1: debate.user1,
            user2: debate.user2
        });

        // Notify debaters that a spectator joined
        io.to(debate.user1).emit('spectator-joined-notify', { spectatorId: socket.id });
        io.to(debate.user2).emit('spectator-joined-notify', { spectatorId: socket.id });

        // Notify all spectators of updated count
        debate.spectators.forEach(spectatorId => {
            io.to(spectatorId).emit('spectator-count-update', {
                count: debate.spectators.length
            });
        });

        console.log(`Spectator ${socket.id} joined debate ${debateId}`);
    });

    // WebRTC for Spectators - Debaters send offers to spectators
    socket.on('spectator-offer', ({ spectatorId, offer, streamType }) => {
        io.to(spectatorId).emit('spectator-receive-offer', {
            debaterId: socket.id,
            offer: offer,
            streamType: streamType // 'user1' or 'user2'
        });
    });

    // Spectators send answers back to debaters
    socket.on('spectator-answer', ({ debaterId, answer }) => {
        io.to(debaterId).emit('spectator-receive-answer', {
            spectatorId: socket.id,
            answer: answer
        });
    });

    // ICE candidates for spectator connections
    socket.on('spectator-ice-candidate', ({ peerId, candidate }) => {
        io.to(peerId).emit('spectator-receive-ice-candidate', {
            peerId: socket.id,
            candidate: candidate
        });
    });

    // Spectator Chat Message
    socket.on('spectator-chat', ({ debateId, message }) => {
        const debate = activeDebates.get(debateId);
        if (!debate || !debate.spectators.includes(socket.id)) return;

        const chatMessage = {
            id: Date.now() + Math.random(),
            socketId: socket.id,
            message: message,
            timestamp: Date.now()
        };

        debate.chatMessages = debate.chatMessages || [];
        debate.chatMessages.push(chatMessage);

        // Keep only last 50 messages
        if (debate.chatMessages.length > 50) {
            debate.chatMessages = debate.chatMessages.slice(-50);
        }

        // Broadcast to all spectators
        debate.spectators.forEach(spectatorId => {
            io.to(spectatorId).emit('spectator-chat-message', chatMessage);
        });
    });

    // Spectator Vote
    socket.on('cast-vote', ({ debateId, vote }) => {
        const debate = activeDebates.get(debateId);
        if (!debate || !debate.spectators.includes(socket.id)) return;

        // Record vote (vote is 'user1' or 'user2')
        debate.votes[socket.id] = vote;

        // Send confirmation
        socket.emit('vote-recorded', { vote: vote });

        // Calculate and broadcast vote totals
        const voteTotals = {
            user1: 0,
            user2: 0
        };

        Object.values(debate.votes).forEach(v => {
            if (v === 'user1') voteTotals.user1++;
            if (v === 'user2') voteTotals.user2++;
        });

        // Broadcast to all spectators
        debate.spectators.forEach(spectatorId => {
            io.to(spectatorId).emit('vote-update', voteTotals);
        });

        console.log(`Vote cast in debate ${debateId}: ${vote}`);
    });

    // Leave spectator mode
    socket.on('leave-spectator', ({ debateId }) => {
        const debate = activeDebates.get(debateId);
        if (debate) {
            debate.spectators = debate.spectators.filter(id => id !== socket.id);
            spectatorRooms.delete(socket.id);

            // Notify remaining spectators
            debate.spectators.forEach(spectatorId => {
                io.to(spectatorId).emit('spectator-count-update', {
                    count: debate.spectators.length
                });
            });
        }
    });

    // ═══════════════════════════════════════════════════════════
    // SAFETY FEATURES
    // ═══════════════════════════════════════════════════════════
    
    // Report User
    socket.on('report-user', (data) => {
        const { reportedSocketId, reporterId, reporterName, reason, topic, timestamp } = data;
        
        console.log(`🚩 REPORT: ${reporterId} (${reporterName}) reported ${reportedSocketId} for: ${reason}`);
        
        const report = {
            reporterId: reporterId,
            reporterName: reporterName,
            reason: reason,
            topic: topic,
            timestamp: timestamp
        };
        
        // Process report and check for auto-ban
        const wasBanned = processReport(reportedSocketId, report);
        
        if (wasBanned) {
            console.log(`🚫 User ${reportedSocketId} was auto-banned`);
        } else {
            const recentCount = getRecentReports(reportedSocketId).length;
            console.log(`📊 User ${reportedSocketId} now has ${recentCount}/${REPORT_THRESHOLD} reports`);
        }
        
        // Send confirmation to reporter
        socket.emit('report-received', {
            success: true,
            message: 'Report received. Thank you for keeping Hot Take safe.'
        });
    });
    
    // Block User
    socket.on('block-user', (data) => {
        const { blockerId, blockedSocketId, timestamp } = data;
        
        console.log(`🚫 BLOCK: ${blockerId} blocked ${blockedSocketId}`);
        
        // Add to blocked pairs
        if (!blockedPairs.has(blockerId)) {
            blockedPairs.set(blockerId, new Set());
        }
        blockedPairs.get(blockerId).add(blockedSocketId);
        
        console.log(`✅ Block added: ${blockerId} → ${blockedSocketId}`);
        
        socket.emit('block-received', {
            success: true,
            message: 'User blocked successfully'
        });
    });
    
    // Skip Topic Request
    socket.on('skip-topic-request', () => {
        const userData = userSockets.get(socket.id);
        if (!userData || !userData.currentDebate) {
            socket.emit('error', { message: 'Not in a debate' });
            return;
        }
        
        const debate = activeDebates.get(userData.currentDebate);
        if (!debate) {
            socket.emit('error', { message: 'Debate not found' });
            return;
        }
        
        const opponentId = debate.user1 === socket.id ? debate.user2 : debate.user1;
        
        console.log(`⏭️ SKIP REQUEST: ${socket.id} wants to skip topic: "${debate.topic}"`);
        
        // Notify opponent of skip request
        io.to(opponentId).emit('skip-topic-requested', {
            requesterId: socket.id,
            topic: debate.topic
        });
        
        // Notify requester
        socket.emit('skip-topic-sent', {
            message: 'Skip request sent to opponent. Waiting for response...'
        });
    });
    
    // Skip Topic Response
    socket.on('skip-topic-response', (data) => {
        const { accepted, requesterId } = data;
        const userData = userSockets.get(socket.id);
        
        if (!userData || !userData.currentDebate) return;
        
        const debate = activeDebates.get(userData.currentDebate);
        if (!debate) return;
        
        console.log(`⏭️ SKIP RESPONSE: ${socket.id} ${accepted ? 'ACCEPTED' : 'DECLINED'} skip request`);
        
        if (accepted) {
            // Both agreed - get new topic
            const newTopic = getRandomTopic();
            debate.topic = newTopic;
            
            console.log(`✅ Topic skipped! New topic: "${newTopic}"`);
            
            // Notify both users
            io.to(debate.user1).emit('topic-skipped', {
                newTopic: newTopic
            });
            io.to(debate.user2).emit('topic-skipped', {
                newTopic: newTopic
            });
        } else {
            // Declined
            io.to(requesterId).emit('skip-topic-declined', {
                message: 'Opponent declined to skip topic'
            });
        }
    });

    // ═══════════════════════════════════════════════════════════
    // PREMIUM FEATURES
    // ═══════════════════════════════════════════════════════════
    
    // Find opponent with topic category (PRO feature)
    socket.on('find-opponent-with-category', (data) => {
        const { category, isPremium } = data;
        
        if (!isPremium) {
            socket.emit('error', { message: 'Premium feature - upgrade to PRO' });
            return;
        }
        
        console.log(`👑 PRO: ${socket.id} searching with category: ${category}`);
        
        // For now, just find any opponent (category filtering can be added later)
        // Trigger normal find-opponent flow
        socket.emit('searching', { message: `Finding opponent in ${category}...` });
        
        // Add to queue
        waitingUsers.add(socket.id);
        
        // Try to match
        if (waitingUsers.size >= 2) {
            const usersArray = Array.from(waitingUsers);
            const user1Id = usersArray[0];
            const user2Id = usersArray[1];
            
            // Check blocks
            if (areUsersBlocked(user1Id, user2Id)) {
                console.log(`🚫 Users blocked - skipping match`);
                return;
            }
            
            waitingUsers.delete(user1Id);
            waitingUsers.delete(user2Id);
            
            // Create debate with topic from selected category
            const debateId = generateDebateId();
            const topic = getTopicByCategory(category); // Use category-specific topic
            const user1Side = getRandomSide();
            const user2Side = user1Side === 'PRO' ? 'CON' : 'PRO';
            const firstSpeaker = Math.random() > 0.5 ? user1Id : user2Id;
            
            const debate = {
                id: debateId,
                user1: user1Id,
                user2: user2Id,
                topic: topic,
                user1Side: user1Side,
                user2Side: user2Side,
                currentSpeaker: firstSpeaker,
                timeStarted: Date.now(),
                round: 1,
                spectators: [],
                votes: {},
                category: category // Track category
            };
            
            activeDebates.set(debateId, debate);
            
            userSockets.get(user1Id).currentDebate = debateId;
            userSockets.get(user2Id).currentDebate = debateId;
            
            io.sockets.sockets.get(user1Id)?.join(debateId);
            io.sockets.sockets.get(user2Id)?.join(debateId);
            
            io.to(user1Id).emit('debate-matched', {
                debateId: debateId,
                opponentId: user2Id,
                topic: topic,
                yourSide: user1Side,
                firstSpeaker: firstSpeaker,
                youGoFirst: firstSpeaker === user1Id,
                round: 1,
                category: category
            });
            
            io.to(user2Id).emit('debate-matched', {
                debateId: debateId,
                opponentId: user1Id,
                topic: topic,
                yourSide: user2Side,
                firstSpeaker: firstSpeaker,
                youGoFirst: firstSpeaker === user2Id,
                round: 1,
                category: category
            });
            
            console.log(`👑 PRO Match created: ${debateId} (${category})`);
        }
    });
    
    // Request rematch (PRO feature)
    socket.on('request-rematch', (data) => {
        const { opponentSocketId, isPremium } = data;
        
        if (!isPremium) {
            socket.emit('error', { message: 'Premium feature - upgrade to PRO' });
            return;
        }
        
        console.log(`👑 PRO: ${socket.id} requesting rematch with ${opponentSocketId}`);
        
        // Send rematch request to opponent
        io.to(opponentSocketId).emit('rematch-request', {
            requesterId: socket.id,
            requesterName: 'User' // Can add name later
        });
        
        // Also track the rematch pair
        socket.on('rematch-accepted', () => {
            console.log(`✅ Rematch accepted: ${socket.id} ↔ ${opponentSocketId}`);
            
            // Create new debate between same users
            const debateId = generateDebateId();
            const topic = getRandomTopic();
            const user1Side = getRandomSide();
            const user2Side = user1Side === 'PRO' ? 'CON' : 'PRO';
            const firstSpeaker = Math.random() > 0.5 ? socket.id : opponentSocketId;
            
            const debate = {
                id: debateId,
                user1: socket.id,
                user2: opponentSocketId,
                topic: topic,
                user1Side: user1Side,
                user2Side: user2Side,
                currentSpeaker: firstSpeaker,
                timeStarted: Date.now(),
                round: 1,
                spectators: [],
                votes: {},
                isRematch: true
            };
            
            activeDebates.set(debateId, debate);
            
            userSockets.get(socket.id).currentDebate = debateId;
            userSockets.get(opponentSocketId).currentDebate = debateId;
            
            io.sockets.sockets.get(socket.id)?.join(debateId);
            io.sockets.sockets.get(opponentSocketId)?.join(debateId);
            
            io.to(socket.id).emit('debate-matched', {
                debateId: debateId,
                opponentId: opponentSocketId,
                topic: topic,
                yourSide: user1Side,
                firstSpeaker: firstSpeaker,
                youGoFirst: firstSpeaker === socket.id,
                round: 1,
                isRematch: true
            });
            
            io.to(opponentSocketId).emit('debate-matched', {
                debateId: debateId,
                opponentId: socket.id,
                topic: topic,
                yourSide: user2Side,
                firstSpeaker: firstSpeaker,
                youGoFirst: firstSpeaker === opponentSocketId,
                round: 1,
                isRematch: true
            });
            
            console.log(`🔄 Rematch started: ${debateId}`);
        });
    });
    
    // Rematch declined
    socket.on('rematch-declined', (data) => {
        const { requesterId } = data;
        io.to(requesterId).emit('rematch-declined', {
            message: 'Opponent declined rematch'
        });
    });

    // Disconnect handling
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);

        // Remove from waiting queue
        waitingUsers.delete(socket.id);

        // Remove from all premium category queues
        for (const [category, queue] of premiumQueues.entries()) {
            queue.delete(socket.id);
            if (queue.size === 0) {
                premiumQueues.delete(category); // Clean up empty queues
            }
        }

        // Remove from spectator rooms
        const spectatingDebateId = spectatorRooms.get(socket.id);
        if (spectatingDebateId) {
            const debate = activeDebates.get(spectatingDebateId);
            if (debate) {
                debate.spectators = debate.spectators.filter(id => id !== socket.id);
                
                // Notify remaining spectators
                debate.spectators.forEach(spectatorId => {
                    io.to(spectatorId).emit('spectator-count-update', {
                        count: debate.spectators.length
                    });
                });
            }
            spectatorRooms.delete(socket.id);
        }

        // Handle active debate
        const userData = userSockets.get(socket.id);
        if (userData && userData.currentDebate) {
            const debate = activeDebates.get(userData.currentDebate);
            if (debate) {
                const opponentId = debate.user1 === socket.id ? debate.user2 : debate.user1;
                
                // Notify opponent
                io.to(opponentId).emit('opponent-disconnected');

                // Notify spectators that debate ended
                if (debate.spectators) {
                    debate.spectators.forEach(spectatorId => {
                        io.to(spectatorId).emit('debate-ended-spectator');
                    });
                }

                // Clean up opponent's data
                const opponentData = userSockets.get(opponentId);
                if (opponentData) opponentData.currentDebate = null;

                // Remove debate
                activeDebates.delete(userData.currentDebate);
            }
        }

        // Remove user data
        userSockets.delete(socket.id);
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        waitingUsers: waitingUsers.size,
        activeDebates: activeDebates.size,
        connectedUsers: userSockets.size
    });
});

// Stats endpoint
app.get('/stats', (req, res) => {
    res.json({
        waitingUsers: waitingUsers.size,
        activeDebates: activeDebates.size,
        totalConnected: userSockets.size,
        debates: Array.from(activeDebates.values()).map(d => ({
            id: d.id,
            phase: d.phase,
            duration: Date.now() - d.startedAt
        }))
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Debate Roulette server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📈 Stats: http://localhost:${PORT}/stats`);
});
