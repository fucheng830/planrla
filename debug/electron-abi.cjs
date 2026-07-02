console.log('runtime=' + (process.versions.electron ? 'electron ' + process.versions.electron : 'node ' + process.version));
console.log('NODE ABI = ' + process.versions.modules);
console.log('node ver = ' + process.versions.node);
process.exit(0);
