const logger = require('./logger');

class SessionQueue {
    constructor() {
        this.queues = new Map();
    }

    /**
     * Get or create a queue for a specific session ID
     * @param {string} sessionId 
     */
    getQueue(sessionId) {
        if (!this.queues.has(sessionId)) {
            this.queues.set(sessionId, {
                tasks: [],
                isProcessing: false
            });
        }
        return this.queues.get(sessionId);
    }

    /**
     * Adds a task to the session's queue and starts processing if not already doing so.
     * @param {string} sessionId 
     * @param {Function} taskFn - An async function containing the message processing/sending logic
     */
    async enqueue(sessionId, taskFn) {
        const queue = this.getQueue(sessionId);
        queue.tasks.push(taskFn);
        
        if (!queue.isProcessing) {
            this.processQueue(sessionId);
        }
    }

    /**
     * Processes tasks sequentially for a given session.
     * Includes a randomized micro-sleep between processing different users to avoid rapid-fire processing.
     * @param {string} sessionId 
     */
    async processQueue(sessionId) {
        const queue = this.getQueue(sessionId);
        queue.isProcessing = true;

        while (queue.tasks.length > 0) {
            const task = queue.tasks.shift();
            try {
                await task();
            } catch (error) {
                logger.error(`[QUEUE_ERR] Error processing task for ${sessionId}: ${error.message}`);
            }

            // Anti-ban: Micro-sleep between processing completely different messages 
            // if there are more in the queue to avoid spamming the connection.
            if (queue.tasks.length > 0) {
                const restTime = Math.floor(Math.random() * (4000 - 2000 + 1) + 2000); // 2 to 4 seconds
                logger.info(`[STEALTH] Sleeping for ${restTime}ms before next message in queue for ${sessionId}...`);
                await new Promise(resolve => setTimeout(resolve, restTime));
            }
        }

        queue.isProcessing = false;
    }
}

// Export a singleton instance
module.exports = new SessionQueue();
