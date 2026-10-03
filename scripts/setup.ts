import { Store } from '../lib/store.ts';
const store = new Store();
console.log('\nCareVault local synthetic demo is ready.');
console.log('Owner access code:', store.credentials.ownerCode);
console.log('Start with npm run dev, then open http://localhost:3040.');
console.log('Integration credentials are in data/credentials.json. Keep that file private and untracked.\n');
store.close();
