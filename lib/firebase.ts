// This file re-exports from the main firebase service to prevent double initialization
// Firebase can only be initialized once per app
import firebaseService from '../src/services/firebase';

// Export database instance from the main firebase service
export const db = firebaseService.database;
