import { api } from './convex/_generated/api.js';
import { ConvexHttpClient } from 'convex/browser';
const client = new ConvexHttpClient(process.env.CONVEX_URL);
const profiles = await client.query(api.profiles.list, {});
console.log('Profiles:', profiles.length);
if (profiles.length > 0) { console.log('First profile listIds:', profiles[0].listIds); }
