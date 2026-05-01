import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_KEY || '';

if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_KEY must be set in .env");
    process.exit(1);
}

const supabase = createClient(url, key);

export class ShortTermMemory {
    constructor(maxLen = 10) {
        this.store = new Map();
        this.maxLen = maxLen;
    }

    add(userId, role, content) {
        if (!this.store.has(userId)) {
            this.store.set(userId, []);
        }
        const history = this.store.get(userId);
        history.push({ role, content });
        if (history.length > this.maxLen) {
            history.shift(); // Remove oldest
        }
    }

    get(userId) {
        return this.store.get(userId) || [];
    }

    clear(userId) {
        this.store.delete(userId);
    }
}

export class LongTermMemory {
    async getFacts(userId) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('facts')
                .eq('user_id', userId);
            
            if (error) throw error;
            if (data && data.length > 0) {
                const raw = data[0].facts;
                return Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw || '[]') : []);
            }
            return [];
        } catch (error) {
            console.error(`getFacts error for ${userId}:`, error);
            return [];
        }
    }

    async saveFacts(userId, newFacts) {
        try {
            const existing = await this.getFacts(userId);
            const existingLower = new Set(existing.map(f => f.toLowerCase()));
            
            for (const fact of newFacts) {
                if (!existingLower.has(fact.toLowerCase())) {
                    existing.push(fact);
                    existingLower.add(fact.toLowerCase());
                }
            }

            const now = new Date().toISOString();
            const { error } = await supabase
                .from('users')
                .upsert({
                    user_id: userId,
                    facts: existing,
                    last_updated: now
                }, { onConflict: 'user_id' });
            
            if (error) throw error;
        } catch (error) {
            console.error(`saveFacts error for ${userId}:`, error);
        }
    }

    async incrementMessageCount(userId) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('message_count')
                .eq('user_id', userId);
            
            if (error) throw error;
            
            const current = (data && data.length > 0) ? data[0].message_count : 0;
            const newCount = current + 1;
            const now = new Date().toISOString();

            const { error: upsertError } = await supabase
                .from('users')
                .upsert({
                    user_id: userId,
                    message_count: newCount,
                    last_updated: now
                }, { onConflict: 'user_id' });
            
            if (upsertError) throw upsertError;
            return newCount;
        } catch (error) {
            console.error(`incrementMessageCount error for ${userId}:`, error);
            return 0;
        }
    }

    async clearUser(userId) {
        try {
            const { error } = await supabase
                .from('users')
                .delete()
                .eq('user_id', userId);
            if (error) throw error;
        } catch (error) {
            console.error(`clearUser error for ${userId}:`, error);
        }
    }
}
