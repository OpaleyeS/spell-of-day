const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// ===== CONFIGURATION =====
// Determine environment
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_DEVELOPMENT = !IS_PRODUCTION;
const PORT = process.env.PORT || 5000;

// ===== CORS CONFIGURATION =====
const getAllowedOrigins = () => {
    if (IS_PRODUCTION) {
        return process.env.ALLOWED_ORIGINS 
            ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
            : ['https://yourdomain.com', 'https://www.yourdomain.com'];
    }
    // Development origins
    return [
        'http://localhost:5000',
        'http://127.0.0.1:5000',
        'http://localhost:3000',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'http://localhost:8080',
        'http://127.0.0.1:8080'
    ];
};

const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = getAllowedOrigins();
        
        // Allow requests with no origin (like mobile apps, curl, Postman)
        if (!origin) {
            return callback(null, true);
        }
        
        if (allowedOrigins.indexOf(origin) !== -1 || IS_DEVELOPMENT) {
            callback(null, true);
        } else {
            console.warn(`🚫 Blocked request from origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With']
};

// ===== MIDDLEWARE =====
// Apply CORS
app.use(cors(corsOptions));

// Body parsing middleware with increased limits for potential large requests
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware (development only)
if (IS_DEVELOPMENT) {
    app.use((req, res, next) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${req.method} ${req.url}`);
        next();
    });
}

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    if (IS_PRODUCTION) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// Static files - serve from public directory with caching
const staticOptions = {
    etag: true,
    lastModified: true,
    setHeaders: (res, filepath) => {
        // Cache static assets for 1 day in production
        if (IS_PRODUCTION) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    }
};
app.use(express.static(path.join(__dirname, 'public'), staticOptions));

// ===== DATABASE CONNECTION =====
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/spellbook';

// MongoDB connection options
const mongooseOptions = {
    autoIndex: IS_DEVELOPMENT, // Don't auto-index in production for performance
    serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds
    socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    family: 4, // Use IPv4, skip trying IPv6
    maxPoolSize: 10, // Maintain up to 10 socket connections
    minPoolSize: 2, // Maintain at least 2 socket connections
    connectTimeoutMS: 10000, // Give up initial connection after 10 seconds
    retryWrites: true,
    retryReads: true
};

// Connect to MongoDB with retry logic
const connectWithRetry = async (retries = 5, delay = 5000) => {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`📦 Attempting to connect to MongoDB (attempt ${i + 1}/${retries})...`);
            await mongoose.connect(MONGODB_URI, mongooseOptions);
            console.log('✅ Connected to MongoDB successfully');
            
            // Set up database indexes after successful connection
            await setupDatabaseIndexes();
            return true;
        } catch (err) {
            console.error(`❌ MongoDB connection attempt ${i + 1} failed:`, err.message);
            
            if (i === retries - 1) {
                console.error('❌ All MongoDB connection attempts failed');
                console.log('⚠️  Continuing without database - some features may be limited');
                return false;
            }
            
            console.log(`⏳ Waiting ${delay / 1000} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return false;
};

// Setup database indexes for better performance
async function setupDatabaseIndexes() {
    try {
        // Only attempt to create indexes if we have a connection
        if (mongoose.connection.readyState !== 1) {
            console.log('⚠️  Database not connected, skipping index creation');
            return;
        }

        const Spell = require('./models/Spell');
        const DailySpell = require('./models/DailySpell');
        
        console.log('🔧 Setting up database indexes...');
        
        // Create indexes in background to avoid blocking
        const indexPromises = [
            Spell.collection.createIndex({ index: 1 }, { unique: true, background: true }).catch(err => 
                console.log('⚠️  Spell index creation skipped:', err.message)
            ),
            Spell.collection.createIndex({ name: 1 }, { background: true }).catch(err => 
                console.log('⚠️  Spell name index creation skipped:', err.message)
            ),
            Spell.collection.createIndex({ level: 1 }, { background: true }).catch(err => 
                console.log('⚠️  Spell level index creation skipped:', err.message)
            ),
            DailySpell.collection.createIndex({ date: 1 }, { unique: true, background: true }).catch(err => 
                console.log('⚠️  DailySpell date index creation skipped:', err.message)
            ),
            DailySpell.collection.createIndex({ spellIndex: 1 }, { background: true }).catch(err => 
                console.log('⚠️  DailySpell spellIndex index creation skipped:', err.message)
            )
        ];
        
        await Promise.allSettled(indexPromises);
        console.log('✅ Database indexes setup completed');
    } catch (error) {
        console.error('⚠️  Error setting up indexes:', error.message);
        // Don't throw - indexes aren't critical for basic functionality
    }
}

// Handle MongoDB connection events
mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('⚠️  MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
    console.log('✅ MongoDB reconnected');
});

mongoose.connection.on('reconnectFailed', () => {
    console.error('❌ MongoDB reconnection failed');
});

// ===== ROUTES =====
// Import routes
const spellRoutes = require('./routes/spellRoutes');

// API routes
app.use('/api', spellRoutes);

// ===== HEALTH CHECK ENDPOINTS =====
// Basic health check
app.get('/health', (req, res) => {
    const dbState = mongoose.connection.readyState;
    const dbStatus = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting',
        99: 'uninitialized'
    };
    
    const memoryUsage = process.memoryUsage();
    
    res.json({
        success: true,
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: IS_PRODUCTION ? 'production' : 'development',
        uptime: Math.floor(process.uptime()),
        mongodb: {
            status: dbStatus[dbState] || 'unknown',
            readyState: dbState,
            host: mongoose.connection.host || 'unknown',
            name: mongoose.connection.name || 'unknown'
        },
        memory: {
            rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
            heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
            heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`
        }
    });
});

// Detailed health check (protected)
app.get('/health/detailed', (req, res) => {
    // Simple protection for detailed health info
    const secret = req.query.secret || req.headers['x-health-secret'];
    if (IS_PRODUCTION && secret !== process.env.HEALTH_SECRET) {
        return res.status(403).json({ 
            success: false,
            error: 'Forbidden - Invalid or missing health secret' 
        });
    }
    
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    res.json({
        success: true,
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: IS_PRODUCTION ? 'production' : 'development',
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        uptime: process.uptime(),
        memory: {
            rss: memoryUsage.rss,
            heapTotal: memoryUsage.heapTotal,
            heapUsed: memoryUsage.heapUsed,
            external: memoryUsage.external
        },
        cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system
        },
        mongodb: {
            status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
            host: mongoose.connection.host,
            port: mongoose.connection.port,
            name: mongoose.connection.name,
            models: Object.keys(mongoose.models),
            collections: Object.keys(mongoose.connection.collections)
        },
        cors: {
            allowedOrigins: getAllowedOrigins(),
            environment: IS_PRODUCTION ? 'production' : 'development'
        },
        env: IS_DEVELOPMENT ? process.env : { NODE_ENV: process.env.NODE_ENV }
    });
});

// ===== FRONTEND ROUTES =====
// Check if index.html exists
const indexPath = path.join(__dirname, 'public', 'index.html');
const hasIndexFile = fs.existsSync(indexPath);

// Serve index.html for root route
app.get('/', (req, res) => {
    if (hasIndexFile) {
        res.sendFile(indexPath);
    } else {
        res.send(`
            <html>
                <head>
                    <title>Spell of the Day API</title>
                    <style>
                        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; line-height: 1.6; }
                        h1 { color: #795663; }
                        code { background: #f4e4c1; padding: 2px 5px; border-radius: 3px; }
                    </style>
                </head>
                <body>
                    <h1>🧙 Spell of the Day API</h1>
                    <p>The API is running but the frontend files are not found.</p>
                    <p>Make sure <code>index.html</code> exists in the <code>public</code> folder.</p>
                    <h2>Available API Endpoints:</h2>
                    <ul>
                        <li><code>GET /api/daily-spell</code> - Today's spell</li>
                        <li><code>GET /api/spells</code> - All spells (paginated)</li>
                        <li><code>GET /api/spells/statistics</code> - Spell statistics</li>
                        <li><code>GET /api/spells/:index</code> - Spell by index</li>
                        <li><code>POST /api/reset</code> - Reset daily tracking (test only)</li>
                        <li><code>GET /health</code> - Health check</li>
                    </ul>
                </body>
            </html>
        `);
    }
});

// Catch-all route for frontend routing - only for non-API routes
app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.url.startsWith('/api/')) {
        return next();
    }
    
    // Skip health check routes
    if (req.url.startsWith('/health')) {
        return next();
    }
    
    // Check if the requested file exists in public directory
    const filePath = path.join(__dirname, 'public', req.url);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return res.sendFile(filePath);
    }
    
    // For all other non-API routes, serve index.html (for client-side routing)
    if (hasIndexFile) {
        res.sendFile(indexPath);
    } else {
        res.status(404).json({
            success: false,
            message: 'Not found',
            path: req.url
        });
    }
});

// ===== 404 HANDLER FOR API =====
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'API endpoint not found',
        path: req.originalUrl,
        method: req.method
    });
});

// ===== ERROR HANDLING MIDDLEWARE =====
app.use((err, req, res, next) => {
    const timestamp = new Date().toISOString();
    
    // Log error
    console.error(`❌ [${timestamp}] Error:`, {
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip
    });

    // CORS errors
    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({
            success: false,
            message: 'CORS error: Origin not allowed'
        });
    }

    // MongoDB errors
    if (err.name === 'MongoError' || err.name === 'MongoServerError') {
        return res.status(503).json({
            success: false,
            message: 'Database error',
            error: IS_DEVELOPMENT ? err.message : 'Service temporarily unavailable'
        });
    }

    // Default error response
    const statusCode = err.status || 500;
    const response = {
        success: false,
        message: err.message || 'Internal server error',
        timestamp: timestamp
    };

    // Add stack trace in development
    if (IS_DEVELOPMENT) {
        response.stack = err.stack;
        response.error = err;
    }

    res.status(statusCode).json(response);
});

// ===== GRACEFUL SHUTDOWN =====
let server;

function gracefulShutdown(signal) {
    console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);
    
    // Close server first to stop accepting new connections
    if (server) {
        server.close(async () => {
            console.log('✅ HTTP server closed');
            
            try {
                // Close database connection
                await mongoose.connection.close();
                console.log('✅ MongoDB connection closed');
                
                console.log('👋 Graceful shutdown completed');
                process.exit(0);
            } catch (err) {
                console.error('❌ Error during shutdown:', err);
                process.exit(1);
            }
        });

        // Force shutdown after timeout
        setTimeout(() => {
            console.error('❌ Forced shutdown after timeout');
            process.exit(1);
        }, 10000);
    } else {
        process.exit(0);
    }
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
});

// ===== START SERVER =====
async function startServer() {
    try {
        // Connect to database
        const dbConnected = await connectWithRetry();
        
        // Start listening
        server = app.listen(PORT, () => {
            console.log(`
    ╔══════════════════════════════════════════════════════════╗
    ║     🧙 Spell of the Day Server                          ║
    ╠══════════════════════════════════════════════════════════╣
    ║  Environment: ${IS_PRODUCTION ? '🌍 Production' : '💻 Development'.padEnd(36)} ║
    ║  Server:      http://localhost:${PORT}${' '.repeat(33 - String(PORT).length)} ║
    ║  Health:      http://localhost:${PORT}/health${' '.repeat(27 - String(PORT).length)} ║
    ║  API Base:    http://localhost:${PORT}/api${' '.repeat(28 - String(PORT).length)} ║
    ║  MongoDB:     ${dbConnected ? '✅ Connected' : '❌ Disconnected'}${' '.repeat(27)} ║
    ║  Frontend:    ${hasIndexFile ? '✅ index.html found' : '❌ index.html missing'}${' '.repeat(22)} ║
    ╚══════════════════════════════════════════════════════════╝
            `);
            
            console.log('📚 Available API Endpoints:');
            console.log('   GET  /api/daily-spell        - Today\'s spell');
            console.log('   GET  /api/spells              - All spells (paginated)');
            console.log('   GET  /api/spells/statistics   - Spell statistics');
            console.log('   GET  /api/spells/:index       - Spell by index');
            console.log('   POST /api/reset                - Reset daily tracking');
            console.log('   POST /api/spells/refresh       - Refresh spell list');
            
            if (IS_DEVELOPMENT) {
                console.log('\n🔧 Development Tools:');
                console.log('   GET  /health/detailed        - Detailed health check');
            }
            
            console.log('\n🚀 Server is ready to accept connections');
        });

        // Handle server errors
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ Port ${PORT} is already in use.`);
                console.error('   Possible solutions:');
                console.error('   1. Stop the other process using this port');
                console.error('   2. Change the PORT in your .env file');
                console.error('   3. Wait a few seconds and try again');
                process.exit(1);
            } else {
                console.error('❌ Server error:', error);
            }
        });

    } catch (err) {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
    }
}

// Start the server
startServer();

module.exports = app; // For testing purposes