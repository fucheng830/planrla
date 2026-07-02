try { require('better-sqlite3'); console.log('ELECTRON_LOAD=OK (better-sqlite3 loads under electron — ABI matches)'); }
catch(e) { const m=e.message.match(/NODE_MODULE_VERSION \d+/g)||[]; console.log('ELECTRON_LOAD=FAIL binary='+m[0]+' needs='+m[1]); }
process.exit(0);
