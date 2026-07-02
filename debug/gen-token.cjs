// Generate a JWT for the existing user (id=1) using the DB-stored secret.
// Non-destructive: reads jwt_secret + user, signs token, prints it. No DB writes.
// Run: node debug/gen-token.cjs
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const jwt = require('jsonwebtoken');

const db = new DatabaseSync(path.join(process.env.USERPROFILE || process.env.HOME, '.planrla', 'auth.db'), { readOnly: true });
const row = db.prepare("SELECT value FROM app_config WHERE key='jwt_secret'").get();
if (!row || !row.value) { console.error('no jwt_secret in app_config'); process.exit(1); }
const user = db.prepare("SELECT id, username FROM users WHERE id=1").get();
if (!user) { console.error('no user id=1'); process.exit(1); }
const token = jwt.sign({ userId: user.id, username: user.username }, row.value, { expiresIn: '7d' });
db.close();
// print ONLY the token to stdout (trailing newline trimmed by consumer)
process.stdout.write(token);
