'use strict';

const { randomUUID } = require('node:crypto');
const logger = require('../../util/logger');

/**
 * Ward alert fan-out.
 *
 * Everything stored here has already passed the PHI guard, so this layer can
 * treat its contents as safe to broadcast, cache, and replay. Nothing
 * identifying is ever written into it.
 */

const MAX_HISTORY = 200;

class NotificationStore {
  constructor() {
    this.items = [];
    this.subscribers = new Set();
  }

  reset() {
    this.items = [];
    for (const subscriber of this.subscribers) subscriber.close();
    this.subscribers.clear();
  }

  publish(alert) {
    const record = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      read: false,
      ...alert,
    };
    this.items.unshift(record);
    if (this.items.length > MAX_HISTORY) this.items.length = MAX_HISTORY;

    for (const subscriber of this.subscribers) {
      try {
        subscriber.send(record);
      } catch (err) {
        logger.warn('notification.push.failed', { reason: err.message });
        this.subscribers.delete(subscriber);
      }
    }
    return record;
  }

  list({ ward, since, limit = 50 } = {}) {
    let results = this.items;
    if (ward) results = results.filter((item) => item.ward === ward);
    if (since) results = results.filter((item) => item.createdAt > since);
    return results.slice(0, limit);
  }

  markRead(id) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return null;
    item.read = true;
    return item;
  }

  markAllRead(ward) {
    let count = 0;
    for (const item of this.items) {
      if (ward && item.ward !== ward) continue;
      if (!item.read) {
        item.read = true;
        count += 1;
      }
    }
    return count;
  }

  unreadCount(ward) {
    return this.items.filter((item) => !item.read && (!ward || item.ward === ward)).length;
  }

  subscribe(subscriber) {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  subscriberCount() {
    return this.subscribers.size;
  }
}

module.exports = new NotificationStore();
module.exports.NotificationStore = NotificationStore;
