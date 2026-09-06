// Keep cached calculator scripts and styles aligned with the current HTML.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function versionAssets(html, readAsset) {
    let count = 0;
    const updated = html.replace(/(<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["'])([^"']+)(["'])/gi,
        (match, prefix, url, quote) => {
            const [file, rawQuery] = url.split('?');
            if (!/^[\w.-]+\.(?:js|css)$/.test(file)) return match;
            const content = readAsset(file).replace(/\r\n/g, '\n');
            const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
            const query = new URLSearchParams(rawQuery);
            query.set('v', hash);
            count++;
            return `${prefix}${file}?${query}${quote}`;
        });
    if (!count) throw Error('No calculator assets found in index.html.');
    return { html: updated, count };
}

if (require.main === module) {
    const root = path.join(__dirname, '..');
    const indexPath = path.join(root, 'index.html');
    const original = fs.readFileSync(indexPath, 'utf8');
    const updated = versionAssets(original, file => fs.readFileSync(path.join(root, file), 'utf8'));
    if (process.argv.includes('--check')) {
        if (updated.html !== original) {
            console.error('Calculator asset versions are stale. Run npm run assets:calculator.');
            process.exitCode = 1;
        } else console.log(`Verified ${updated.count} calculator asset versions.`);
    } else {
        fs.writeFileSync(indexPath, updated.html);
        console.log(`Updated ${updated.count} calculator asset versions.`);
    }
}
module.exports = { versionAssets };
