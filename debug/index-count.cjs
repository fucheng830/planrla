const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const db = new DatabaseSync(path.join(process.env.USERPROFILE||process.env.HOME,'.planrla','auth.db'), { readOnly: true });
try { console.log('indexed rows: ' + db.prepare("SELECT COUNT(*) n FROM session_search").get().n); } catch(e){ console.log('locked/err:', e.message); }
db.close();
